import type { SchemaObject } from 'ajv'
import { ensureControllerMeta, ensureMethodMeta, joinRoutePath, resolveControllerMeta } from './metadata.js'
import type { ControllerConstructor, MethodMeta } from './metadata.js'

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
 * Converts a koa-router path to an OpenAPI path template and lists its
 * parameters: `/users/:id(\\d+)` becomes `/users/{id}`.
 */
function toOpenAPIPath(routePath: string): { path: string, params: string[] } {
  const params: string[] = []
  const path = routePath
    .replace(/:([A-Za-z0-9_]+)(\([^)]*\))?[?*+]?/g, (_match, name: string) => {
      params.push(name)
      return `{${name}}`
    })
    .replace(/\*([A-Za-z0-9_]+)/g, (_match, name: string) => {
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
 * Generates an OpenAPI 3.1 document from decorated controller classes.
 *
 * Paths and HTTP methods come from the route decorators. Parameters and the
 * request body come from `@stateInput`: `from: 'params'` fields become path
 * parameters, `from: 'query'` fields become query parameters, and the
 * remaining fields form a JSON request body. The top-level `properties` and
 * `required` of `@validateState` schemas on the same method are merged into
 * those fields; anything else in such a schema, like a root `oneOf`, is not
 * reflected.
 * Summaries, tags and responses come from {@link apiDoc}.
 *
 * Controllers are not instantiated. Routes whose verb is not an OpenAPI HTTP
 * method are left out.
 *
 * @param options Generation options.
 * @param options.controllerConstructors Decorated controller classes, for
 * example from `loadControllersAsync`.
 * @param options.info Title and version of the API.
 * @param options.prefix Prefix added to every path; use the same value as the
 * router's `prefix`.
 * @param options.servers Optional OpenAPI server objects.
 * @param options.components Optional OpenAPI components object, copied to the
 * document unchanged. Use it for security schemes or shared response schemas.
 * @param options.security Optional security requirements applied to every
 * operation.
 * @returns The OpenAPI document as a plain object.
 *
 * @example
 * ```ts
 * const controllerConstructors = await loadControllersAsync({ files: 'src/controllers/*.ts' })
 * const document = generateOpenAPI({
 *   controllerConstructors,
 *   info: { title: 'Blog API', version: '1.0.0' },
 * })
 * ```
 */
export function generateOpenAPI({
  controllerConstructors,
  info,
  prefix = '',
  servers,
  components,
  security,
}: {
  controllerConstructors: ControllerConstructor[]
  info: OpenAPIInfo
  prefix?: string
  servers?: OpenAPIDocument['servers']
  components?: OpenAPIDocument['components']
  security?: OpenAPIDocument['security']
}): OpenAPIDocument {
  const paths: OpenAPIDocument['paths'] = {}
  const operationIds = new Set<string>()

  for (const controllerConstructor of controllerConstructors) {
    if (typeof controllerConstructor !== 'function') continue
    const controllerMeta = resolveControllerMeta(controllerConstructor)
    if (!controllerMeta) continue
    const controllerName = controllerConstructor.name
    const controllerDoc = controllerMeta.doc ?? {}

    controllerMeta.methodMetaMap.forEach((methodMeta, propertyName) => {
      if (typeof controllerConstructor.prototype[propertyName] !== 'function') return
      const doc = methodMeta.doc ?? {}
      // Only `@validateState` rejects requests; `@stateInput` copies values as they are.
      const validated = methodMeta.stateSchemas.length > 0
      const deprecated = doc.deprecated ?? controllerDoc.deprecated

      for (const controllerPrefix of controllerMeta.prefixs) {
        for (const { verb, pathname } of methodMeta.routes) {
          const method = verb.toLowerCase()
          if (!httpMethods.includes(method)) continue
          const routePath = joinRoutePath(prefix || '/', joinRoutePath(controllerPrefix, pathname))
          const { path, params } = toOpenAPIPath(routePath)

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
    })
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
