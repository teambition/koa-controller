import Ajv, { SchemaObject } from 'ajv'
import * as createHttpError from 'http-errors'
import { defaultManager } from './router'

const ajv = new Ajv({
  coerceTypes: true,
  useDefaults: true,
})

export function validator(jsonSchema: SchemaObject, routerManager = defaultManager) {
  const validate = ajv.compile(jsonSchema)
  return routerManager.before(async (ctx) => {
    if (!validate(ctx)) {
      const error = validate.errors[0]
      error.message = (error.instancePath || '/') + ' ' + error.message
      throw createHttpError(400, error.message, { ...error })
    }
  })
}
