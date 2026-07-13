import { Ajv } from 'ajv'
import type { SchemaObject } from 'ajv'
import createHttpError from 'http-errors'
import { before } from './router.js'

/**
 * Shared AJV instance used by {@link validate} and {@link validateState} when
 * a custom instance is not supplied.
 *
 * Type coercion and default values are enabled, so successful validation may
 * modify the validated context or state object.
 */
export const globalAjvInstance = new Ajv({
  coerceTypes: true,
  useDefaults: true,
})

/**
 * Validates the complete Koa context before a controller route runs.
 *
 * The schema is compiled when the decorator is created. On failure, the
 * decorator throws an HTTP 400 error using the first AJV validation error. Use
 * {@link validateState} when only the controller state should be validated.
 *
 * @param jsonSchema AJV-compatible JSON Schema applied to the Koa context.
 * @param options Validation options.
 * @param options.ajv AJV instance used to compile the schema. Defaults to
 * {@link globalAjvInstance}.
 * @returns A class or method decorator implemented as a `before` middleware.
 * @throws An HTTP 400 error when validation fails.
 *
 * @example
 * ```ts
 * @validate({
 *   type: 'object',
 *   required: ['query'],
 *   properties: {
 *     query: {
 *       type: 'object',
 *       required: ['id'],
 *       properties: {
 *         id: { type: 'integer' },
 *       },
 *     },
 *   },
 * })
 * @get('/users')
 * async getUser(state, ctx) {
 *   return userService.find(ctx.query.id)
 * }
 * ```
 */
export function validate(jsonSchema: SchemaObject, {
  ajv = globalAjvInstance,
}: {
  ajv?: Ajv
} = {}) {
  const validate = ajv.compile(jsonSchema)
  return before(async function validateMW (ctx) {
    if (!validate(ctx)) {
      const error = validate.errors[0]
      error.message = (error.instancePath || '/') + ' ' + error.message
      throw createHttpError(400, error.message, { ...error })
    }
  })
}

/**
 * Validates `ctx.state` before a controller route runs.
 *
 * Place {@link state} above this decorator when state must first be populated
 * from query, body, or route parameters. The schema is compiled when the
 * decorator is created. On failure, the decorator throws an HTTP 400 error
 * using the first AJV validation error.
 *
 * @param jsonSchema AJV-compatible JSON Schema applied to `ctx.state`.
 * @param options Validation options.
 * @param options.ajv AJV instance used to compile the schema. Defaults to
 * {@link globalAjvInstance}.
 * @returns A class or method decorator implemented as a `before` middleware.
 * @throws An HTTP 400 error when validation fails.
 *
 * @example
 * ```ts
 * interface CreateUserState {
 *   name: string
 *   age?: number
 * }
 *
 * @post('/users')
 * @state()
 * @validateState({
 *   type: 'object',
 *   required: ['name'],
 *   properties: {
 *     name: { type: 'string', minLength: 1 },
 *     age: { type: 'integer', minimum: 0 },
 *   },
 * })
 * async createUser(state: CreateUserState) {
 *   return userService.create(state)
 * }
 * ```
 */
export function validateState(jsonSchema: SchemaObject, {
  ajv = globalAjvInstance,
}: {
  ajv?: typeof globalAjvInstance
} = {}) {
  const validate = ajv.compile(jsonSchema)
  return before(async function validateStateMW (ctx) {
    if (!validate(ctx.state)) {
      const error = validate.errors[0]
      error.message = (error.instancePath || '/') + ' ' + error.message
      throw createHttpError(400, error.message, { ...error })
    }
  })
}
