import path from 'path'
import { pathToFileURL } from 'node:url'
import { globSync } from 'glob'
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
type Middleware = KoaMiddleware<DefaultState, Context>

/**
 * A function used by {@link before} and {@link after}.
 *
 * The function receives the current Koa context and must return a promise.
 * It does not receive Koa's `next` callback; use {@link middleware} when the
 * middleware needs to wrap downstream execution.
 */
export interface MiddlewareFn {
  (ctx: Context): Promise<void>
}

type MiddlewareMaker = (options: {controllerName: string, propertyName?: string}) => Middleware

const debug = Debug('koa:controller')
const controllerSymbol = Symbol('controller')

type Controller = object

interface ControllerConstructor {
  new (): Controller
  [controllerSymbol]?: ControllerMeta
}

class ControllerMeta {
  prefixs: string[] = []
  middlewares: Middleware[] = []
  methodMetaMap: Map<string, MethodMeta> = new Map()
}

function ensureControllerMeta(constructor: ControllerConstructor): ControllerMeta {
  let meta = constructor[controllerSymbol]
  if (!meta) {
    meta = new ControllerMeta()
    constructor[controllerSymbol] = meta
  }
  return meta
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

/**
 * Marks a class as a controller and registers a prefix for all routes declared
 * on that class.
 *
 * A controller may declare more than one prefix by applying the decorator more
 * than once. Controller classes loaded through {@link getRouterAsync} or
 * {@link getRouterSync} must be exported from their modules.
 *
 * Controller instances are created once when the router is built, so
 * request-specific mutable data should be stored on `ctx` rather than on the
 * controller instance.
 *
 * @param prefix Route prefix applied before each method pathname.
 * @returns A class decorator.
 *
 * @example
 * ```ts
 * @controller('/api/users')
 * export class UserController {
 *   @get('/:id')
 *   async getUser(state, ctx) {
 *     return { id: ctx.params.id }
 *   }
 * }
 * ```
 */
export function controller(prefix = '/') {
  assert.ok(prefix)
  return (constructor: ControllerConstructor) => {
    debug(`@controller ${constructor.name} prefix = ${prefix}`)
    const controllerMeta = ensureControllerMeta(constructor)
    if (!controllerMeta.prefixs.includes(prefix)) {
      controllerMeta.prefixs.push(prefix)
    }
  }
}

/**
 * Registers standard Koa middleware on a controller class or one of its route
 * methods.
 *
 * The middleware must return a promise and may run code both before and after
 * `await next()`, following Koa's onion model. Class-level middleware runs
 * before method-level middleware.
 *
 * @param middleware An async Koa middleware function.
 * @returns A class or method decorator.
 *
 * @example
 * ```ts
 * @get('/items')
 * @middleware(async (ctx, next) => {
 *   const startedAt = Date.now()
 *   await next()
 *   ctx.set('x-duration', String(Date.now() - startedAt))
 * })
 * async listItems() {
 *   return []
 * }
 * ```
 */
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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (target: any, propertyName?: string, _descriptor?: PropertyDescriptor) => {
    if (typeof propertyName === 'undefined') {
      // class Decorator
      const constructor: ControllerConstructor = target
      const controllerName = constructor.name
      debug(`@middleware for controller ${controllerName}`)

      const mw = mwMaker({ controllerName })

      const controllerMeta = ensureControllerMeta(constructor)
      if (pushToBottom) {
        controllerMeta.middlewares.push(mw)
      } else {
        controllerMeta.middlewares.unshift(mw)
      }
    } else {
      // method Decorator
      const constructor: ControllerConstructor = target.constructor
      const controllerName = constructor.name
      debug(`@middleware for method ${controllerName}/${propertyName}`)

      const mw = mwMaker({ controllerName, propertyName })

      const controllerConstructor: ControllerConstructor = target.constructor
      const methodMetaMap = ensureControllerMeta(controllerConstructor).methodMetaMap
      if (!methodMetaMap.has(propertyName)) {
        methodMetaMap.set(propertyName, new MethodMeta())
      }
      const methodMeta = methodMetaMap.get(propertyName)
      assert.ok(methodMeta)

      if (pushToBottom) {
        methodMeta.middlewares.push(mw)
      } else {
        methodMeta.middlewares.unshift(mw)
      }
    }
  }
}
  
/**
 * Registers a function that runs before the next controller middleware or
 * route method.
 *
 * Use this decorator for one-way setup such as authentication checks, request
 * normalization, or populating `ctx.state`. Use {@link middleware} instead
 * when code must also run after the route method.
 *
 * @param beforeFunc Async function invoked with the current Koa context.
 * @returns A class or method decorator.
 *
 * @example
 * ```ts
 * @before(async ctx => {
 *   if (!ctx.get('authorization')) ctx.throw(401)
 * })
 * @get('/profile')
 * async profile(state) {
 *   return state.user
 * }
 * ```
 */
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
  
/**
 * Registers a function that runs after the route and downstream middleware
 * complete successfully.
 *
 * The callback is not invoked when downstream middleware throws. Decorate the
 * controller class to apply the callback to every route, or decorate a method
 * to apply it only to that route method.
 *
 * @param afterFunc Async function invoked with the current Koa context.
 * @returns A class or method decorator.
 *
 * @example
 * ```ts
 * @get('/items')
 * @after(async ctx => {
 *   ctx.set('x-handler-complete', 'true')
 * })
 * async listItems() {
 *   return []
 * }
 * ```
 */
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

/**
 * Registers a controller method for an HTTP verb and pathname.
 *
 * The decorated method is called with `ctx.state` as its first argument and
 * the Koa context as its second argument. It must return a promise; the
 * resolved value is assigned to `ctx.body`. The same method may be registered
 * for multiple routes by applying this decorator more than once.
 *
 * @param verb HTTP method understood by `koa-router`, such as `get`, `post`,
 * `put`, `patch`, or `delete`.
 * @param pathname Route pathname relative to the controller prefix.
 * @returns A method decorator.
 *
 * @example
 * ```ts
 * @request('delete', '/:id')
 * async deleteUser(state, ctx) {
 *   await userService.remove(ctx.params.id)
 *   ctx.status = 204
 * }
 * ```
 */
export function request(verb = 'get', pathname = '/') {
  assert.ok(verb)
  assert.ok(pathname)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (target: any, propertyName: string, _descriptor?: PropertyDescriptor) => {
    const controllerConstructor: ControllerConstructor = target.constructor
    debug(`@request ${controllerConstructor.name}/${propertyName} ${verb} ${pathname}`)
    const methodMetaMap = ensureControllerMeta(controllerConstructor).methodMetaMap
    if (!methodMetaMap.has(propertyName)) {
      methodMetaMap.set(propertyName, new MethodMeta())
    }
    const methodMeta = methodMetaMap.get(propertyName)
    assert.ok(methodMeta)

    methodMeta.routes.push(new Route({
      verb,
      pathname,
    }))
  }
}

/**
 * Registers a controller method as an HTTP GET route.
 *
 * This is equivalent to `@request('get', pathname)`.
 *
 * @param path Route pathname relative to the controller prefix.
 * @returns A method decorator.
 *
 * @example
 * ```ts
 * @get('/:id')
 * async getUser(state, ctx) {
 *   return userService.find(ctx.params.id)
 * }
 * ```
 */
export function get(path = '/') {
  return request('get', path)
}

/**
 * Registers a controller method as an HTTP POST route.
 *
 * This is equivalent to `@request('post', pathname)`.
 *
 * @param path Route pathname relative to the controller prefix.
 * @returns A method decorator.
 *
 * @example
 * ```ts
 * @post('/')
 * async createUser(state) {
 *   return userService.create(state)
 * }
 * ```
 */
export function post(path = '/') {
  return request('post', path)
}

/**
 * Builds a Koa router from an explicit list of decorated controller classes.
 *
 * Use this function when controller constructors are already available, for
 * example with dependency injection or in tests. Each controller is
 * instantiated once while the router is built. Constructors without
 * controller/route metadata are ignored.
 *
 * @param options Router construction options.
 * @param options.controllerConstructors Decorated controller classes to
 * register.
 * @param options.prefix Optional prefix applied to every registered route.
 * @param options.logger Optional logger reserved for router loading.
 * @returns A configured `koa-router` instance. Mount both `routes()` and
 * `allowedMethods()` on the Koa application.
 *
 * @example
 * ```ts
 * const router = loadRouter({
 *   prefix: '/v1',
 *   controllerConstructors: [UserController],
 * })
 *
 * app.use(router.routes())
 * app.use(router.allowedMethods())
 * ```
 */
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
    const controllerMethods = controller as Record<string, unknown>

    controllerMeta.methodMetaMap.forEach((methodMeta, propertyName) => {
      debug('getRouter method', methodMeta)
      const controllerMethod = controllerMethods[propertyName]
      if (typeof controllerMethod !== 'function') return
      const routerName = controllerName + '/' + propertyName
      const methodMiddlewares = methodMeta.middlewares || []

      // run process
      const mainMW: Middleware = async (ctx) => {
        const span = ctx.span?.tracer().startSpan(routerName, { childOf: ctx.span })
        span?.setTag('Controller', controllerName)
        span?.setTag('Method', propertyName)
        ctx.body = await Promise.resolve(controllerMethod.call(controller, ctx.state, ctx)).finally(() => {
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

/**
 * Discovers controller modules with a glob, loads them with `require()`, and
 * builds a Koa router.
 *
 * Use this synchronous loader only when every matched controller module can be
 * loaded by CommonJS `require()`. Each controller class must be exported from
 * its module. Use {@link getRouterAsync} for ESM controller modules.
 *
 * @param options Controller discovery and router options.
 * @param options.cwd Base directory used to resolve `files`. Defaults to
 * `process.cwd()`.
 * @param options.files Glob pattern for controller modules. By default it
 * recursively matches JavaScript and TypeScript files below `api`.
 * @param options.prefix Optional prefix applied to every registered route.
 * @param options.logger Optional logger forwarded to {@link loadRouter}.
 * @returns A configured `koa-router` instance.
 *
 * @example
 * ```ts
 * const router = getRouterSync({
 *   cwd: process.cwd(),
 *   files: 'src/controllers/*.[jt]s',
 *   prefix: '/v1',
 * })
 *
 * app.use(router.routes())
 * app.use(router.allowedMethods())
 * ```
 */
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
  globSync(files, { cwd }).forEach(file => {
    debug(`getRouterSync: load file ${file} ...`)
    collectExports(localRequire(path.resolve(cwd, file)), controllerConstructors)
  })
  return loadRouter({ prefix, controllerConstructors, logger })
}

/**
 * Discovers controller modules with a glob, loads them with dynamic `import()`,
 * and builds a Koa router.
 *
 * This is the recommended loader for ESM projects. Every controller class must
 * be exported from its module. Files are imported sequentially in glob result
 * order before their exported classes are passed to {@link loadRouter}.
 *
 * @param options Controller discovery and router options.
 * @param options.cwd Base directory used to resolve `files`. Defaults to
 * `process.cwd()`.
 * @param options.files Glob pattern for controller modules. By default it
 * recursively matches JavaScript and TypeScript files below `api`.
 * @param options.prefix Optional prefix applied to every registered route.
 * @param options.logger Optional logger forwarded to {@link loadRouter}.
 * @returns A promise resolving to a configured `koa-router` instance.
 *
 * @example
 * ```ts
 * const router = await getRouterAsync({
 *   cwd: process.cwd(),
 *   files: 'src/controllers/*.[jt]s',
 *   prefix: '/v1',
 * })
 *
 * app.use(router.routes())
 * app.use(router.allowedMethods())
 * ```
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
  const matchedFiles = globSync(files, { cwd })
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
    controllerConstructors.push(exportObject as ControllerConstructor)
  } else if (typeof exportObject === 'object') {
    Object.values(exportObject).forEach(exportMember => {
      if (typeof exportMember === 'function') {
        controllerConstructors.push(exportMember as ControllerConstructor)
      }
    })
  }
}
