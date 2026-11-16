import type { SchemaObject } from 'ajv'
import type KoaRouter from 'koa-router'
import { ensureControllerMeta, ensureMethodMeta, joinRoutePath, routeSymbol, routerSymbol } from './metadata.js'
import type { MethodMeta, RouteInfo } from './metadata.js'

/** An OpenAPI response object, passed through to the document unchanged. */
export interface OpenAPIResponse {
  description: string
  [key: string]: unknown
}

/** Documentation attached to a route or controller with {@link apiDoc}. */
export interface ApiDocOptions {
  /** Short summary of the operation. Ignored on a class. */
  summary?: string
  /** Longer description of the operation. Ignored on a class. */
  description?: string
  /** Tags used to group operations. Defaults to the controller class name. */
  tags?: string[]
  /** Unique operation name. Defaults to `ControllerName_methodName`. Ignored on a class. */
  operationId?: string
  /** Marks the operation as deprecated. */
  deprecated?: boolean
  /** OpenAPI response objects keyed by status code. */
  responses?: Record<string, OpenAPIResponse>
}

/** An OpenAPI parameter object produced by {@link generateOpenAPI}. */
export interface OpenAPIParameter {
  name: string
  in: 'path' | 'query'
  required: boolean
  schema: SchemaObject
}

/** An OpenAPI operation object produced by {@link generateOpenAPI}. */
export interface OpenAPIOperation {
  operationId: string
  tags: string[]
  summary?: string
  description?: string
  deprecated?: boolean
  parameters?: OpenAPIParameter[]
  requestBody?: {
    required: boolean
    content: { 'application/json': { schema: SchemaObject } }
  }
  responses: Record<string, OpenAPIResponse>
}

/** The `info` object of an OpenAPI document. */
export interface OpenAPIInfo {
  title: string
  version: string
  [key: string]: unknown
}

/** An OpenAPI 3.1 document produced by {@link generateOpenAPI}. */
export interface OpenAPIDocument {
  openapi: '3.1.0'
  info: OpenAPIInfo
  servers?: { url: string, [key: string]: unknown }[]
  paths: Record<string, Record<string, OpenAPIOperation>>
  components?: Record<string, unknown>
  security?: Record<string, string[]>[]
}

/**
 * Adds documentation to a route for {@link generateOpenAPI}.
 *
 * On a method, it describes that operation. On a controller class, `tags`,
 * `deprecated` and `responses` become the defaults for every route of the
 * class. It has no effect on request handling.
 *
 * @param options Documentation for the operation.
 * @returns A class or method decorator.
 *
 * @example
 * ```ts
 * @get('/:id')
 * @apiDoc({
 *   summary: 'Get a user',
 *   responses: {
 *     200: { description: 'The user' },
 *     404: { description: 'No user has this id' },
 *   },
 * })
 * async getUser(state) {}
 * ```
 */
export function apiDoc(options: ApiDocOptions) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (target: any, propertyName?: string, _descriptor?: PropertyDescriptor): void => {
    if (typeof propertyName === 'string') {
      const methodMeta = ensureMethodMeta(target.constructor, propertyName)
      methodMeta.doc = { ...methodMeta.doc, ...options }
    } else {
      const controllerMeta = ensureControllerMeta(target)
      controllerMeta.doc = { ...controllerMeta.doc, ...options }
    }
  }
}

const httpMethods = ['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace']

/**
 * Expands the optional groups of a koa-router path into every path it can
 * match: `/users{/:id}` becomes `/users` and `/users/:id`.
 */
function expandOptionalGroups(routePath: string): string[] {
  const start = routePath.indexOf('{')
  if (start === -1) return [routePath]
  let depth = 0
  for (let end = start; end < routePath.length; end++) {
    if (routePath[end] === '{') depth++
    else if (routePath[end] === '}' && --depth === 0) {
      const before = routePath.slice(0, start)
      const inner = routePath.slice(start + 1, end)
      const after = routePath.slice(end + 1)
      return [...expandOptionalGroups(before + after), ...expandOptionalGroups(before + inner + after)]
    }
  }
  return [routePath]
}

/**
 * Converts a koa-router path without optional groups to an OpenAPI path
 * template and lists its parameters: `/files/:dir/*rest` becomes
 * `/files/{dir}/{rest}`.
 */
function toOpenAPIPath(routePath: string): { path: string, params: string[] } {
  const params: string[] = []
  const path = routePath.replace(/[:*]([A-Za-z_$][A-Za-z0-9_$]*)/g, (_match, name: string) => {
    params.push(name)
    return `{${name}}`
  })
  return { path, params }
}

/**
 * Collects what `@validateState` schemas say about each top-level field, so
 * stricter rules such as `integer` or `minimum` appear in the document.
 */
function collectStateRules(stateSchemas: SchemaObject[]) {
  const properties: Record<string, SchemaObject> = {}
  const required = new Set<string>()
  for (const schema of stateSchemas) {
    if (schema.properties && typeof schema.properties === 'object') {
      for (const [name, rule] of Object.entries(schema.properties)) {
        if (rule && typeof rule === 'object') {
          properties[name] = { ...properties[name], ...(rule as SchemaObject) }
        }
      }
    }
    if (Array.isArray(schema.required)) {
      for (const name of schema.required) required.add(String(name))
    }
  }
  return { properties, required }
}

function buildOperation(methodMeta: MethodMeta, pathParams: string[]) {
  const parameters: OpenAPIParameter[] = []
  const bodyProperties: Record<string, SchemaObject> = {}
  const bodyRequired: string[] = []
  const fields = methodMeta.input ?? {}
  const rules = collectStateRules(methodMeta.input ? methodMeta.stateSchemas : [])
  const schemaOf = (name: string): SchemaObject => ({ ...fields[name].schema, ...rules.properties[name] })

  for (const name of pathParams) {
    const declared = fields[name]?.from === 'params'
    parameters.push({ name, in: 'path', required: true, schema: declared ? schemaOf(name) : { type: 'string' } })
  }
  for (const [name, field] of Object.entries(fields)) {
    const source = field.from ?? 'body'
    const required = field.required || rules.required.has(name)
    if (source === 'query') {
      parameters.push({ name, in: 'query', required, schema: schemaOf(name) })
    } else if (source === 'body') {
      bodyProperties[name] = schemaOf(name)
      if (required) bodyRequired.push(name)
    }
  }

  const operation: Pick<OpenAPIOperation, 'parameters' | 'requestBody'> = {}
  if (parameters.length > 0) operation.parameters = parameters
  if (Object.keys(bodyProperties).length > 0) {
    operation.requestBody = {
      required: bodyRequired.length > 0,
      content: {
        'application/json': {
          schema: {
            type: 'object',
            properties: bodyProperties,
            ...(bodyRequired.length > 0 ? { required: bodyRequired } : {}),
          },
        },
      },
    }
  }
  return operation
}

/**
 * Lists the OpenAPI methods of a layer. koa-router adds `HEAD` to every `GET`
 * route, which is left out, as are verbs OpenAPI has no method for.
 */
function toOpenAPIMethods(methods: string[]): string[] {
  const lower = methods.map(method => method.toLowerCase())
  return lower.filter(method => httpMethods.includes(method) && !(method === 'head' && lower.includes('get')))
}

/**
 * Generates an OpenAPI 3.1 document from a router built by `loadRouter`,
 * `getRouterSync` or `getRouterAsync`.
 *
 * Every route the router serves is documented with the path it is actually
 * registered under, including the router's prefix. Parameters and the request
 * body come from `@stateInput`: `from: 'params'` fields become path
 * parameters, `from: 'query'` fields become query parameters, and the
 * remaining fields form a JSON request body. The top-level `properties` and
 * `required` of `@validateState` schemas on the same method are merged into
 * those fields; anything else in such a schema, like a root `oneOf`, is not
 * reflected. Summaries, tags and responses come from {@link apiDoc}.
 *
 * A router that contains another router's routes (`parent.use(router.routes())`)
 * can be passed as well. Routes added to the router by hand, such as
 * `router.get(...)`, are left out, as are routes whose verb is not an OpenAPI
 * HTTP method.
 *
 * @param options Generation options.
 * @param options.router The router to document.
 * @param options.info Title and version of the API.
 * @param options.prefix Prefix added to every path, for a router mounted under
 * a path the router itself does not know about, such as with `koa-mount`.
 * @param options.servers Optional OpenAPI server objects.
 * @param options.components Optional OpenAPI components object, copied to the
 * document unchanged. Use it for security schemes or shared response schemas.
 * @param options.security Optional security requirements applied to every
 * operation.
 * @returns The OpenAPI document as a plain object.
 * @throws A `TypeError` when the router was not built by this package and
 * contains none of its routes.
 *
 * @example
 * ```ts
 * const router = await getRouterAsync({ files: 'src/controllers/*.ts', prefix: '/v1' })
 * const document = generateOpenAPI({
 *   router,
 *   info: { title: 'Blog API', version: '1.0.0' },
 * })
 * ```
 */
export function generateOpenAPI({
  router,
  info,
  prefix = '',
  servers,
  components,
  security,
}: {
  router: KoaRouter
  info: OpenAPIInfo
  prefix?: string
  servers?: OpenAPIDocument['servers']
  components?: OpenAPIDocument['components']
  security?: OpenAPIDocument['security']
}): OpenAPIDocument {
  // The handler `loadRouter` registers is the last middleware of each route.
  const routes = (router.stack ?? []).flatMap(layer => {
    const handler = layer.stack[layer.stack.length - 1] as { [routeSymbol]?: RouteInfo } | undefined
    const info = handler?.[routeSymbol]
    return info ? [{ layer, info }] : []
  })
  if (!(routerSymbol in router) && routes.length === 0) {
    throw new TypeError('generateOpenAPI expects a router built by loadRouter, getRouterSync or getRouterAsync')
  }

  const paths: OpenAPIDocument['paths'] = {}
  const operationIds = new Set<string>()

  for (const { layer, info: { controllerName, propertyName, controllerMeta, methodMeta } } of routes) {
    const doc = methodMeta.doc ?? {}
    const controllerDoc = controllerMeta.doc ?? {}
    const validated = methodMeta.stateSchemas.length > 0
    const deprecated = doc.deprecated ?? controllerDoc.deprecated
    const routePath = prefix ? joinRoutePath(prefix, layer.path) : layer.path

    for (const method of toOpenAPIMethods(layer.methods)) {
      for (const variant of expandOptionalGroups(routePath)) {
        const { path, params } = toOpenAPIPath(variant)

        const baseId = doc.operationId ?? `${controllerName}_${propertyName}`
        let operationId = baseId
        for (let n = 2; operationIds.has(operationId); n++) operationId = `${baseId}_${n}`
        operationIds.add(operationId)

        const operation: OpenAPIOperation = {
          operationId,
          tags: doc.tags ?? controllerDoc.tags ?? [controllerName],
          ...(doc.summary !== undefined ? { summary: doc.summary } : {}),
          ...(doc.description !== undefined ? { description: doc.description } : {}),
          ...(deprecated !== undefined ? { deprecated } : {}),
          ...buildOperation(methodMeta, params),
          responses: {
            ...(doc.responses || controllerDoc.responses ? {} : { 200: { description: 'Successful response' } }),
            ...(validated ? { 400: { description: 'Invalid request' } } : {}),
            ...controllerDoc.responses,
            ...doc.responses,
          },
        }
        paths[path] = { ...paths[path], [method]: operation }
      }
    }
  }

  return {
    openapi: '3.1.0',
    info,
    ...(servers ? { servers } : {}),
    paths,
    ...(components ? { components } : {}),
    ...(security ? { security } : {}),
  }
}
