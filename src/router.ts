import * as path from 'path'
import * as glob from 'glob'
import * as Debug from 'debug'
import * as KoaRouter from 'koa-router'
import type { Context as KoaContext, DefaultState, Middleware as KoaMiddleware } from 'koa'
import type { Span } from 'opentracing'
import type { SchemaObject } from 'ajv'

const debug = Debug('koa:controller')

interface Controller {
}

interface ControllerConstructor extends Function {
  new (): Controller
}

export interface MiddlewareFn {
  (ctx: Context): Promise<void>
}

interface ControllerMeta {
  prefixs: string[]
  constructor: ControllerConstructor
  middlewares: Middleware[]
  befores: MiddlewareFn[]
  afters: MiddlewareFn[]
  methodMap: Record<string, RouteMeta>
}


interface Context extends KoaContext {
  span?: Span
  routePath?: string
}
interface Middleware extends KoaMiddleware<DefaultState, Context> { }

interface RouteMetaRoute {
  verb: string
  path: string
}
interface RouteMeta {
  routes: RouteMetaRoute[]
  middlewares: Middleware[]
  befores: MiddlewareFn[]
  afters: MiddlewareFn[]
  requestStream?: boolean
  responseStream?: boolean
  propertyName: string
}

export class KoaRouterManager {
  controllerMap = new Map<ControllerConstructor, ControllerMeta>()
  logger: any
  
  controller(prefix = '/') {
    return (constructor: ControllerConstructor) => {
      debug('@controller', prefix)
      if (!this.controllerMap.has(constructor)) {
        this.controllerMap.set(constructor, {
            prefixs: [],
            constructor,
            middlewares: [],
            befores: [],
            afters: [],
            methodMap: {},
        })
        return
      }
      if (prefix) {
        if (!this.controllerMap.get(constructor).prefixs.includes(prefix))
        this.controllerMap.get(constructor).prefixs.push(prefix)
       }
    }
  }
  
  middleware(middleware: Middleware) {
    return (target: any, propertyName?: string, descriptor?: PropertyDescriptor) => {
      debug('@middleware')
      if (typeof propertyName === 'undefined') {
        // class Decorator
        const constructor: ControllerConstructor = target
        if (!this.controllerMap.has(constructor)) this.controller('')(constructor)
        this.controllerMap.get(constructor).middlewares.unshift(middleware)
      } else {
        // method Decorator
        const constructor: ControllerConstructor = target.constructor
        if (!this.controllerMap.has(constructor)) this.controller('')(constructor)
        if (!this.controllerMap.get(constructor).methodMap[propertyName]) this.request('', '')(target, propertyName, descriptor)
        this.controllerMap.get(constructor).methodMap[propertyName].middlewares.unshift(middleware)
      }
    }
  }
  
  before(beforeFunc: MiddlewareFn) {
    return (target: any, propertyName?: string, descriptor?: PropertyDescriptor) => {
      debug('@before')
      if (typeof propertyName === 'undefined') {
        // class Decorator
        const constructor: ControllerConstructor = target
        if (!this.controllerMap.has(constructor)) this.controller('')(constructor)
        this.controllerMap.get(constructor).befores.unshift(beforeFunc)
      } else {
        // method Decorator
        const constructor: ControllerConstructor = target.constructor
        if (!this.controllerMap.has(constructor)) this.controller('')(constructor)
        if (!this.controllerMap.get(constructor).methodMap[propertyName]) this.request('', '')(target, propertyName, descriptor)
        this.controllerMap.get(constructor).methodMap[propertyName].befores.unshift(beforeFunc)
      }
    }
  }
  
  after(afterFunc: MiddlewareFn) {
    return (target: any, propertyName?: string, descriptor?: PropertyDescriptor) => {
      debug('@after')
      if (typeof propertyName === 'undefined') {
        // class Decorator
        const constructor: ControllerConstructor = target
        if (!this.controllerMap.has(constructor)) this.controller('')(constructor)
        this.controllerMap.get(constructor).afters.unshift(afterFunc)
      } else {
        // method Decorator
        const constructor: ControllerConstructor = target.constructor
        if (!this.controllerMap.has(constructor)) this.controller('')(constructor)
        if (!this.controllerMap.get(constructor).methodMap[propertyName]) this.request('', '')(target, propertyName, descriptor)
        this.controllerMap.get(constructor).methodMap[propertyName].afters.unshift(afterFunc)
      }
    }
  }
  
  request(verb = 'get', path = '/') {
    return (target: any, propertyName: string, descriptor: PropertyDescriptor) => {
      const constructor = target.constructor
      debug('@request', verb, path)
      if (!this.controllerMap.has(constructor)) this.controller('')(constructor)
      const methodMap = this.controllerMap.get(constructor).methodMap
      if (!methodMap[propertyName]) {
        methodMap[propertyName] = {
          routes: [],
          middlewares: [],
          befores: [],
          afters: [],
          requestStream: false,
          responseStream: false,
          propertyName,
        }
      }
      if (verb && path) {
        methodMap[propertyName].routes.push({
          verb,
          path,
        })
      }
    }
  }
  
  get(path = '/') {
    return this.request('get', path)
  }
  
  post(path = '/') {
    return this.request('post', path)
  }
  
  getRouter(prefix = '') {
    debug('getRouter')
    const router = new KoaRouter({ prefix })
    const controllers = Array.from(this.controllerMap.values())
    debug('getRouter controller.length', controllers.length)
    controllers.forEach(controllerMeta => {
      debug('getRouter controller prefix:', controllerMeta.prefixs)
      if (!controllerMeta.prefixs?.length) return
      const controller = new controllerMeta.constructor()
      const controllerName = controllerMeta.constructor.name
      const controllerMiddlewares: Middleware[] = [...controllerMeta.middlewares]

      // before after middlewares
      controllerMiddlewares.push(async (ctx, next) => {
        for (const before of controllerMeta.befores) {
          debug('running controller before')
          const span = ctx.span?.tracer().startSpan(controllerName + '/' + (before.name || 'before'), { childOf: ctx.span })
          span?.setTag('Controller', controllerName)
          span?.setTag('Middeware', 'before')
          await before(ctx).finally(() => {
            span?.finish()
          })
        }
        debug('running controller')
        await next()
        for (const after of controllerMeta.afters) {
          debug('running controller after')
          const span = ctx.span?.tracer().startSpan(controllerName + '/' + (after.name || 'after'), { childOf: ctx.span })
          span?.setTag('Controller', controllerName)
          span?.setTag('Middeware', 'after')
          await after(ctx).finally(() => {
            span?.finish()
          })
        }
      })
  
      const methods = Object.values(controllerMeta.methodMap)
      methods.forEach(methodMeta => {
        debug('getRouter method', methodMeta)
        const routerName = controllerName + '/' + methodMeta.propertyName
        if (!methodMeta.routes?.length) return
        const middlewares: Middleware[] = []
  
        // middleware
        middlewares.push(...methodMeta.middlewares)
        debug('methodMeta.middlewares', methodMeta.middlewares.length)
  
        // before after middlewares
        middlewares.push(async (ctx, next) => {
          for (const before of methodMeta.befores) {
            debug('running method before')
            const span = ctx.span?.tracer().startSpan(routerName + '/' + (before.name || 'before'), { childOf: ctx.span })
            span?.setTag('Method', methodMeta.propertyName)
            span?.setTag('Middeware', 'before')
            await before(ctx).finally(() => {
              span?.finish()
            })
          }
          debug('running method function')
          await next()
          for (const after of methodMeta.afters) {
            debug('running method after')
            const span = ctx.span?.tracer().startSpan(routerName + '/' + (after.name || 'after'), { childOf: ctx.span })
            span?.setTag('Controller', controllerName)
            span?.setTag('Method', methodMeta.propertyName)
            span?.setTag('Middeware', 'after')
            await after(ctx).finally(() => {
              span?.finish()
            })
          }
        })
  
        // run process
        middlewares.push(async (ctx) => {
          const span = ctx.span?.tracer().startSpan(routerName, { childOf: ctx.span })
          span?.setTag('Controller', controllerName)
          span?.setTag('Method', methodMeta.propertyName)
          ctx.body = await controller[methodMeta.propertyName](ctx.state, ctx).finally(() => {
            span?.finish()
          })
        })
  
        for (const controllerPrefix of controllerMeta.prefixs) {
          for (const { verb, path: pathname } of methodMeta.routes) {
            const routePath = (path.join(controllerPrefix, pathname)).replace(/\/+$/, '') || '/'
            router.register(routePath, [verb], [...controllerMiddlewares, ...middlewares], { name: routerName })
          }
        }
      })
    })
    return router
  }
  
  clearAll() {
    this.controllerMap.clear()  
  }
  
  getRouterSync({
    cwd = process.cwd(),
    files = 'api/**/*.[jt]s',
    prefix = '',
    logger
  }: {
    cwd?: string
    files?: string
    prefix?: string
    logger?: any
  } = {}) {
    glob.sync(files, { cwd }).forEach(file => {
      if (logger) logger.debug(`load api file ${file} ...`)
      require(path.resolve(cwd, file))
    })
    return this.getRouter(prefix)
  }
}

export const defaultManager = new KoaRouterManager()

export function controller(path?: string) {
  return defaultManager.controller(path)
}

export function request(verb = 'get', path = '/') {
  return defaultManager.request(verb, path)
}

export function before(func: MiddlewareFn) {
  return defaultManager.before(func)
}

export function after(func: MiddlewareFn) {
  return defaultManager.after(func)
}

export function get(path?: string) {
  return defaultManager.get(path)
}

export function post(path?: string) {
  return defaultManager.post(path)
}

export function middleware(middleware: Middleware) {
  return defaultManager.middleware(middleware)
}

export function getRouterSync({
  cwd = process.cwd(),
  files = 'api/**/*.[jt]s',
  prefix = '',
  logger,
}: {
  cwd?: string
  files?: string
  prefix?: string
  logger?: any
} = {}) {
  return defaultManager.getRouterSync({cwd, files, prefix, logger})
}
