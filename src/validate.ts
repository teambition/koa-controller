import Ajv, { SchemaObject } from 'ajv'
import * as createHttpError from 'http-errors'
import { KoaRouterManager, defaultManager } from './router'

export const globalAjvInstance = new Ajv({
  coerceTypes: true,
  useDefaults: true,
})

export function validate(jsonSchema: SchemaObject, {
  ajv = globalAjvInstance,
  routerManager = defaultManager,
}: {
  ajv?: Ajv
  routerManager?: KoaRouterManager
} = {}) {
  const validate = ajv.compile(jsonSchema)
  return routerManager.before(async (ctx) => {
    if (!validate(ctx)) {
      const error = validate.errors[0]
      error.message = (error.instancePath || '/') + ' ' + error.message
      throw createHttpError(400, error.message, { ...error })
    }
  })
}

export function validateState(jsonSchema: SchemaObject, {
  ajv = globalAjvInstance,
  routerManager = defaultManager,
}: {
  ajv?: Ajv
  routerManager?: KoaRouterManager
} = {}) {
  const validate = ajv.compile(jsonSchema)
  return routerManager.before(async (ctx) => {
    if (!validate(ctx.state)) {
      const error = validate.errors[0]
      error.message = (error.instancePath || '/') + ' ' + error.message
      throw createHttpError(400, error.message, { ...error })
    }
  })
}
