import path from 'path'
import type { Context as KoaContext, DefaultState, Middleware as KoaMiddleware } from 'koa'
import type { SchemaObject } from 'ajv'
import type { Span } from 'opentracing'
import type { ApiDocOptions } from './openapi.js'
import type { InputFields } from './state-input.js'

export interface Context extends KoaContext {
  span?: Span
}
export type Middleware = KoaMiddleware<DefaultState, Context>

// Registered globally so that every loaded copy of this package (ESM and CJS
// builds, or duplicated installs) recognizes the same controller metadata.
const controllerSymbol = Symbol.for('@tng/koa-controller:controller')

type Controller = object

export interface ControllerConstructor {
  new (): Controller
  [controllerSymbol]?: ControllerMeta
}

export class Route {
  verb: string
  pathname: string
  constructor({ verb, pathname }: { verb: string, pathname: string }) {
    this.verb = verb
    this.pathname = pathname
  }
}

/**
 * Metadata of one controller method.
 *
 * Metadata is stored under a global symbol, so it may have been written by
 * another installed copy of this package, including older versions whose
 * method metadata only has `routes` and `middlewares`. Fields added since then
 * must be treated as possibly missing when reading metadata that has not been
 * through {@link ensureMethodMeta} or {@link resolveControllerMeta}.
 */
export class MethodMeta {
  routes: Route[] = []
  middlewares: Middleware[] = []
  /** Fields declared with `@stateInput`. */
  input?: InputFields
  /** Schemas declared with `@validateState`, in execution order. */
  stateSchemas: SchemaObject[] = []
  /** Documentation declared with `@apiDoc`. */
  doc?: ApiDocOptions
}

export class ControllerMeta {
  prefixs: string[] = []
  middlewares: Middleware[] = []
  methodMetaMap: Map<string, MethodMeta> = new Map()
  /** Documentation declared with `@apiDoc` on the class. */
  doc?: ApiDocOptions
}

function getOwnControllerMeta(constructor: ControllerConstructor): ControllerMeta | undefined {
  // Static members are inherited through the prototype chain, so a plain
  // property read on a subclass would return the parent's metadata.
  return Object.prototype.hasOwnProperty.call(constructor, controllerSymbol)
    ? constructor[controllerSymbol]
    : undefined
}

export function ensureControllerMeta(constructor: ControllerConstructor): ControllerMeta {
  let meta = getOwnControllerMeta(constructor)
  if (!meta) {
    meta = new ControllerMeta()
    constructor[controllerSymbol] = meta
  }
  return meta
}

export function ensureMethodMeta(constructor: ControllerConstructor, propertyName: string): MethodMeta {
  const { methodMetaMap } = ensureControllerMeta(constructor)
  let methodMeta = methodMetaMap.get(propertyName)
  if (!methodMeta) {
    methodMeta = new MethodMeta()
    methodMetaMap.set(propertyName, methodMeta)
  }
  // Created by an older copy of this package, which had no `stateSchemas`.
  if (!Array.isArray(methodMeta.stateSchemas)) methodMeta.stateSchemas = []
  return methodMeta
}

/**
 * Merges the metadata declared on a controller class with the metadata
 * declared on its parent classes.
 *
 * Routes and middlewares are inherited, with parent middlewares placed before
 * the subclass's own so that they wrap them. Prefixes are not inherited: a
 * class is only registered under the prefixes it declares itself. For the
 * state input and documentation of a method, the subclass's declaration
 * replaces the parent's.
 */
export function resolveControllerMeta(constructor: ControllerConstructor): ControllerMeta | undefined {
  const ownMeta = getOwnControllerMeta(constructor)
  if (!ownMeta) return undefined

  const chain: ControllerMeta[] = []
  for (let current = constructor; typeof current === 'function'; current = Object.getPrototypeOf(current)) {
    const meta = getOwnControllerMeta(current)
    if (meta) chain.unshift(meta)
  }

  const resolved = new ControllerMeta()
  resolved.prefixs = [...ownMeta.prefixs]
  for (const meta of chain) {
    resolved.middlewares.push(...meta.middlewares)
    if (meta.doc) resolved.doc = { ...resolved.doc, ...meta.doc }
    meta.methodMetaMap.forEach((methodMeta, propertyName) => {
      let resolvedMethodMeta = resolved.methodMetaMap.get(propertyName)
      if (!resolvedMethodMeta) {
        resolvedMethodMeta = new MethodMeta()
        resolved.methodMetaMap.set(propertyName, resolvedMethodMeta)
      }
      resolvedMethodMeta.routes.push(...methodMeta.routes)
      resolvedMethodMeta.middlewares.push(...methodMeta.middlewares)
      // Absent on metadata written by an older copy of this package.
      resolvedMethodMeta.stateSchemas.push(...(methodMeta.stateSchemas ?? []))
      if (methodMeta.input) resolvedMethodMeta.input = methodMeta.input
      if (methodMeta.doc) resolvedMethodMeta.doc = { ...resolvedMethodMeta.doc, ...methodMeta.doc }
    })
  }
  return resolved
}

/**
 * Joins a controller prefix and a route pathname into the path registered on
 * the router.
 */
export function joinRoutePath(prefix: string, pathname: string): string {
  return path.posix.join(prefix, pathname).replace(/\/+$/, '') || '/'
}

// Registered globally, like the controller metadata, so that routers and
// routes built by one copy of this package are recognized by another.
/** Marks a router built by `loadRouter`. */
export const routerSymbol = Symbol.for('@tng/koa-controller:router')
/** Holds the {@link RouteInfo} of a route handler registered by `loadRouter`. */
export const routeSymbol = Symbol.for('@tng/koa-controller:route')

/** What a route handler built by `loadRouter` knows about its controller method. */
export interface RouteInfo {
  controllerName: string
  propertyName: string
  /** Metadata of the controller, merged with its parent classes. */
  controllerMeta: ControllerMeta
  /** Metadata of the method, merged with its parent classes. */
  methodMeta: MethodMeta
}

/** Defines a property that does not show up when the object is logged or copied. */
export function defineHidden(target: object, key: symbol, value: unknown): void {
  Object.defineProperty(target, key, { value, configurable: true, enumerable: false, writable: true })
}
