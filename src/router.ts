import * as path from 'path'
import * as glob from 'glob'
import * as Debug from 'debug'
import * as KoaRouter from 'koa-router'
import type { Context as KoaContext, DefaultState, Middleware as KoaMiddleware } from 'koa'
import type { Span } from 'opentracing'
import type { SchemaObject } from 'ajv'
import type Ajv from 'ajv'
import { Logger } from './logger'
import { strict as assert } from'assert'

interface Context extends KoaContext {
  span?: Span
  routePath?: string
}
interface Middleware extends KoaMiddleware<DefaultState, Context> { }

export interface MiddlewareFn {
  (ctx: Context): Promise<void>
}

const debug = Debug('koa:controller')
const controllerSymbol = Symbol('controller')

interface Controller {
}

interface ControllerConstructor extends Function {
  new (): Controller
  [controllerSymbol]?: ControllerMeta
}

class ControllerMeta {
  prefixs: string[] = []
  middlewares: Middleware[] = []
  methodMetaMap: Map<string, MethodMeta> = new Map()
}

class Route {
  verb: string
  pathname: string
  constructor({ verb, pathname }: { verb: string, pathname: string }) {
    this.verb = verb
    this.pathname = pathname
  }
}
class MethodMeta {
  routes: Route[] = []
  middlewares: Middleware[] = []
  requestStream?: boolean = false
  responseStream?: boolean = false
}

export function controller(prefix = '/') {
  assert.ok(prefix)
  return (constructor: ControllerConstructor) => {
    debug(`@controller ${constructor.name} prefix = ${prefix}`)
    if (!Reflect.has(constructor, controllerSymbol)) {
      Reflect.set(constructor, controllerSymbol, new ControllerMeta())
    }

    if (!Reflect.get(constructor, controllerSymbol).prefixs.includes(prefix)) {
      Reflect.get(constructor, controllerSymbol).prefixs.push(prefix)
    }
  }
}

export function middleware(middleware: Middleware, pushToBottom = false) {
  const middlewareName = middleware.name || 'middleware'
  return (target: any, propertyName?: string, descriptor?: PropertyDescriptor) => {
    if (typeof propertyName === 'undefined') {
      // class Decorator
      const constructor: ControllerConstructor = target
      const controllerName = constructor.name
      debug(`@middleware for controller ${controllerName}`)

      const mw: Middleware = async (ctx, next) => {
        debug(`invoke controllerMiddleware ${controllerName}/${middlewareName}`)
        const span = ctx.span?.tracer().startSpan(`${controllerName}/${middlewareName}`, { childOf: ctx.span })
        span?.setTag('Controller', controllerName)
        span?.setTag('Middeware', middlewareName)
        return middleware(ctx, next).finally(() => {
          span?.finish()
        })
      }
      Object.defineProperty(mw, 'name', { value: middlewareName })

      if (!Reflect.has(constructor, controllerSymbol)) {
        Reflect.set(constructor, controllerSymbol, new ControllerMeta())
      }
      if (pushToBottom) {
        Reflect.get(constructor, controllerSymbol).middlewares.push(mw)
      } else {
        Reflect.get(constructor, controllerSymbol).middlewares.unshift(mw)
      }
    } else {
      // method Decorator
      const constructor: ControllerConstructor = target.constructor
      const controllerName = constructor.name
      debug(`@middleware for method ${controllerName}/${propertyName}`)

      const mw: Middleware = async (ctx, next) => {
        debug(`invoke methodMiddleware ${controllerName}/${propertyName}/${middlewareName}`)
        const span = ctx.span?.tracer().startSpan(`${controllerName}/${propertyName}/${middlewareName}}`, { childOf: ctx.span })
        span?.setTag('Controller', controllerName)
        span?.setTag('Method', propertyName)
        span?.setTag('Middeware', middlewareName)
        return middleware(ctx, next).finally(() => {
          span?.finish()
        })
      }
      Object.defineProperty(mw, 'name', { value: middlewareName })

      const controllerConstructor: ControllerConstructor = target.constructor
      if (!Reflect.has(controllerConstructor, controllerSymbol)) {
        Reflect.set(controllerConstructor, controllerSymbol, new ControllerMeta())
      }
      const methodMetaMap = Reflect.get(controllerConstructor, controllerSymbol).methodMetaMap
      if (!methodMetaMap.has(propertyName)) {
        methodMetaMap.set(propertyName, new MethodMeta())
      }

      if (pushToBottom) {
        methodMetaMap.get(propertyName).middlewares.push(mw)
      } else {
        methodMetaMap.get(propertyName).middlewares.unshift(mw)
      }
    }
  }
}
  
export function before(beforeFunc: MiddlewareFn) {
  const beforeName = beforeFunc.name || 'before'
  const mw: Middleware = async (ctx, next) => {
    await beforeFunc(ctx)
    return next()
  }
  Object.defineProperty(mw, 'name', { value: beforeName })
  return middleware(mw)
}
  
export function after(afterFunc: MiddlewareFn) {
  const afterName = afterFunc.name || 'after'
  const mw: Middleware = async (ctx, next) => {
    await next()
    await afterFunc(ctx)
  }
  Object.defineProperty(mw, 'name', { value: afterName })
  return middleware(mw, true)
}

export function request(verb = 'get', pathname = '/') {
  assert.ok(verb)
  assert.ok(pathname)
  return (target: any, propertyName: string, descriptor: PropertyDescriptor) => {
    const controllerConstructor: ControllerConstructor = target.constructor
    debug(`@request ${controllerConstructor.name}/${propertyName} ${verb} ${pathname}`)
    if (!Reflect.has(controllerConstructor, controllerSymbol)) {
      Reflect.set(controllerConstructor, controllerSymbol, new ControllerMeta())
    }
    const methodMetaMap = Reflect.get(controllerConstructor, controllerSymbol).methodMetaMap
    if (!methodMetaMap.has(propertyName)) {
      methodMetaMap.set(propertyName, new MethodMeta())
    }

    methodMetaMap.get(propertyName).routes.push(new Route({
      verb,
      pathname,
    }))
  }
}

export function get(path = '/') {
  return request('get', path)
}

export function post(path = '/') {
  return request('post', path)
}

export function getRouter({
  prefix = '',
  logger,
  controllerConstructors,
}: {
  prefix?: string
  logger?: Logger
  controllerConstructors: ControllerConstructor[]
}) {
  debug(`getRouter controllers: ${controllerConstructors.length}`)
  const router = new KoaRouter({ prefix })
  controllerConstructors.forEach(controllerConstructor => {
    if (typeof controllerConstructor !== 'function') return
    const controllerMeta = Reflect.get(controllerConstructor, controllerSymbol)
    if (!controllerMeta) return

    const controller = new controllerConstructor()
    const controllerName = controllerConstructor.name
    const controllerMiddlewares = controllerMeta.middlewares || []

    controllerMeta.methodMetaMap.forEach((methodMeta, propertyName) => {
      debug('getRouter method', methodMeta)
      if (typeof controller[propertyName] !== 'function') return
      const routerName = controllerName + '/' + propertyName
      const methodMiddlewares = methodMeta.middlewares || []

      // run process
      const mainMW: Middleware = async (ctx) => {
        const span = ctx.span?.tracer().startSpan(routerName, { childOf: ctx.span })
        span?.setTag('Controller', controllerName)
        span?.setTag('Method', propertyName)
        ctx.body = await controller[propertyName](ctx.state, ctx).finally(() => {
          span?.finish()
        })
      }

      for (const prefix of controllerMeta.prefixs) {
        for (const { verb, pathname } of methodMeta.routes) {
          const route = (path.join(prefix, pathname)).replace(/\/+$/, '') || '/'
          debug(`register ${verb} ${route} ${routerName} (${controllerMiddlewares.length + methodMiddlewares.length} mw)`)
          router.register(route, [verb], [...controllerMiddlewares, ...methodMiddlewares, mainMW], { name: routerName })
        }
      }
    })
  })
  return router
}

export function getRouterSync({
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
  const controllerConstructors: ControllerConstructor[] = []
  glob.sync(files, { cwd }).forEach(file => {
    debug(`getRouterSync: load file ${file} ...`)
    const exportObject = require(path.resolve(cwd, file))
    if (typeof exportObject === 'function') { 
      controllerConstructors.push(exportObject)
    } else if (typeof exportObject === 'object') {
      Object.values(exportObject)
        .filter(exportMember => typeof exportMember === 'function')
        .forEach((exportMember: ControllerConstructor) => {
          controllerConstructors.push(exportMember)
        })
    }
  })
  return getRouter({ prefix, controllerConstructors, logger })
}
