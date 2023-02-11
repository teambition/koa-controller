import Ajv, { SchemaObject } from 'ajv'
import * as createHttpError from 'http-errors'
import { before } from './router'

export const globalAjvInstance = new Ajv({
  coerceTypes: true,
  useDefaults: true,
})

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

export function validateState(jsonSchema: SchemaObject, {
  ajv = globalAjvInstance,
}: {
  ajv?: Ajv
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
