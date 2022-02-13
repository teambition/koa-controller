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
  prefix: string
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

interface RouteMeta {
  verb: string
  path: string
  params?: Record<string, string[]>
  middlewares: Middleware[]
  befores: MiddlewareFn[]
  afters: MiddlewareFn[]
  // validator: ValidateFunction<any>
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
            prefix,
            constructor,
            middlewares: [],
            befores: [],
            afters: [],
            methodMap: {},
        })
        return
      }
      this.controllerMap.get(constructor).prefix = prefix
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
  
  validator(jsonSchema: SchemaObject) { }
  
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
          verb,
          path,
          params: {},
          middlewares: [],
          befores: [],
          afters: [],
          requestStream: false,
          responseStream: false,
          propertyName,
        }
        return
      }
      methodMap[propertyName].verb = verb
      methodMap[propertyName].path = path
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
    controllers.forEach(controllerMeta => {
      debug('getRouter controller prefix:', controllerMeta.prefix)
      if (!controllerMeta.prefix) return
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
        const traceName = controllerName + '/' + methodMeta.propertyName
        const routePath = (controllerMeta.prefix + methodMeta.path).replace(/\/+$/, '')
        // debug('getRouter method verb:', methodMeta.verb, ' prefix:', controllerMeta.prefix, 'path:', methodMeta.path)
        if (!methodMeta.path) return
        const middlewares: Middleware[] = []
  
        // // define data middleware
        // middlewares.push(async (ctx, next) => {
        //   debug('running define state data')
        //   ctx.routePath = routePath
        //   ctx.state = Object.assign({}, ctx.query, ctx.params, ctx.request.body)
        //   if (methodMeta.params) {
        //     const all = {
        //       params: ctx.params,
        //       query: ctx.query,
        //       body: ctx.request.body,
        //       header: ctx.headers
        //     }
        //     ctx.state = Object.keys(methodMeta.params).reduce((result, key) => {
        //       let value: any = undefined
        //       methodMeta.params[key].some(fromPath => {
        //         const fromKey = fromPath.split('.')[1] || key
        //         value = all[fromPath] && all[fromPath][fromKey] || undefined
        //         return value !== undefined
        //       })
        //       return Object.assign(result, {[key]: value})
        //     }, {})
        //   }
        //   return next()
        // })
  
        // middleware
        middlewares.push(...methodMeta.middlewares)
        debug('methodMeta.middlewares', methodMeta.middlewares.length)
  
        // before after middlewares
        middlewares.push(async (ctx, next) => {
          for (const before of methodMeta.befores) {
            debug('running method before')
            const span = ctx.span?.tracer().startSpan(traceName + '/' + (before.name || 'before'), { childOf: ctx.span })
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
            const span = ctx.span?.tracer().startSpan(traceName + '/' + (after.name || 'after'), { childOf: ctx.span })
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
          const span = ctx.span?.tracer().startSpan(traceName, { childOf: ctx.span })
          span?.setTag('Controller', controllerName)
          span?.setTag('Method', methodMeta.propertyName)
          ctx.body = await controller[methodMeta.propertyName](ctx.state, ctx).finally(() => {
            span?.finish()
          })
        })
  
        router.register(routePath, [methodMeta.verb], [...controllerMiddlewares, ...middlewares])
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
      if (logger) {
        logger.debug(`load api file ${file} ...`)
      }
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

export function validator(jsonSchema: SchemaObject) {
  return defaultManager.validator(jsonSchema)
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
