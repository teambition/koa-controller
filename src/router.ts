import path from 'path'
import { pathToFileURL } from 'node:url'
import glob from 'glob'
import Debug from 'debug'
import KoaRouter from 'koa-router'
import type { Context as KoaContext, DefaultState, Middleware as KoaMiddleware } from 'koa'
import type { Span } from 'opentracing'
import type { Logger } from './logger.js'
import { strict as assert } from'assert'
import { createRequire } from 'node:module'

interface Context extends KoaContext {
  span?: Span
  routePath?: string
}
interface Middleware extends KoaMiddleware<DefaultState, Context> { }

export interface MiddlewareFn {
  (ctx: Context): Promise<void>
}

type MiddlewareMaker = (options: {controllerName: string, propertyName?: string}) => Middleware

const debug = Debug('koa:controller')
const controllerSymbol = Symbol('controller')

interface Controller {
}

interface ControllerConstructor {
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

export function middleware(middleware: Middleware) {
  const middlewareName = middleware.name || 'middleware'
  return internalMiddleware(({controllerName, propertyName}) => async (ctx, next) => {
    const mwFullpath = [controllerName, propertyName, middlewareName].filter(Boolean).join('/')
    debug(`invoke controllerMiddleware ${mwFullpath}`)
    const span = ctx.span?.tracer().startSpan(`${mwFullpath}`, { childOf: ctx.span })
    span?.setTag('Controller', controllerName)
    if (propertyName) {
      span?.setTag('Method', propertyName)
    }
    span?.setTag('Middeware', middlewareName)
    return middleware(ctx, next).finally(() => {
      span?.finish()
    })
  })
}

function internalMiddleware(mwMaker: MiddlewareMaker, { pushToBottom = false } = {}) {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars, @typescript-eslint/no-explicit-any
  return (target: any, propertyName?: string, _descriptor?: PropertyDescriptor) => {
    if (typeof propertyName === 'undefined') {
      // class Decorator
      const constructor: ControllerConstructor = target
      const controllerName = constructor.name
      debug(`@middleware for controller ${controllerName}`)

      const mw = mwMaker({ controllerName })

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

      const mw = mwMaker({ controllerName })

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
  const mwMaker: MiddlewareMaker = ({ controllerName, propertyName }) => async (ctx, next) => {
    const mwFullpath = [controllerName, propertyName, beforeName].filter(Boolean).join('/')
    debug(`invoke before ${mwFullpath}`)
    const span = ctx.span?.tracer().startSpan(`${mwFullpath}`, { childOf: ctx.span })
    span?.setTag('Controller', controllerName)
    if (propertyName) {
      span?.setTag('Method', propertyName)
    }
    span?.setTag('Before', beforeName)
    await beforeFunc(ctx).finally(() => span?.finish())
    return next()
  }
  return internalMiddleware(mwMaker)
}
  
export function after(afterFunc: MiddlewareFn) {
  const afterName = afterFunc.name || 'after'
  const mwMaker: MiddlewareMaker = ({ controllerName, propertyName }) => async (ctx, next) => {
    const mwFullpath = [controllerName, propertyName, afterName].filter(Boolean).join('/')
    await next()
    debug(`invoke after ${mwFullpath}`)
    const span = ctx.span?.tracer().startSpan(`${mwFullpath}`, { childOf: ctx.span })
    span?.setTag('Controller', controllerName)
    if (propertyName) {
      span?.setTag('Method', propertyName)
    }
    span?.setTag('Before', afterName)
    await afterFunc(ctx).finally(() => span?.finish())
  }
  return internalMiddleware(mwMaker, { pushToBottom: true })
}

export function request(verb = 'get', pathname = '/') {
  assert.ok(verb)
  assert.ok(pathname)
  // eslint-disable-next-line @typescript-eslint/no-unused-vars, @typescript-eslint/no-explicit-any
  return (target: any, propertyName: string, _descriptor?: PropertyDescriptor) => {
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

export function loadRouter({
  prefix = '',
  logger: _logger,
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
  logger?: Logger
} = {}) {
  const controllerConstructors: ControllerConstructor[] = []
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore TS1343 — import.meta only in ESM, stripped for CJS build
  const metaUrl: string = import.meta?.url ?? ''
  const localRequire: NodeRequire = metaUrl ? createRequire(metaUrl) as NodeRequire : require as NodeRequire
  glob.sync(files, { cwd }).forEach(file => {
    debug(`getRouterSync: load file ${file} ...`)
    collectExports(localRequire(path.resolve(cwd, file)), controllerConstructors)
  })
  return loadRouter({ prefix, controllerConstructors, logger })
}

/**
 * Async version of getRouterSync. Uses dynamic import() to load controller files,
 * works in both CJS and ESM projects. Controller files can use either module syntax.
 */
export async function getRouterAsync({
  cwd = process.cwd(),
  files = 'api/**/*.[jt]s',
  prefix = '',
  logger
}: {
  cwd?: string
  files?: string
  prefix?: string
  logger?: Logger
} = {}): Promise<KoaRouter> {
  const controllerConstructors: ControllerConstructor[] = []
  const matchedFiles = glob.sync(files, { cwd })
  for (const file of matchedFiles) {
    debug(`loadControllers: load file ${file} ...`)
    const fileUrl = pathToFileURL(path.resolve(cwd, file)).href
    const exportObject = await import(fileUrl)
    collectExports(exportObject, controllerConstructors)
  }
  return loadRouter({ prefix, controllerConstructors, logger })
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function collectExports(exportObject: any, controllerConstructors: ControllerConstructor[]) {
  if (typeof exportObject === 'function') {
    controllerConstructors.push(exportObject)
  } else if (typeof exportObject === 'object') {
    Object.values(exportObject)
      .filter(exportMember => typeof exportMember === 'function')
      .forEach((exportMember: ControllerConstructor) => {
        controllerConstructors.push(exportMember)
      })
  }
}
