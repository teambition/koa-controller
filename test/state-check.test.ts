import 'mocha'
import { strict as assert } from 'assert'
import { controller, post, loadRouter } from '../src/router.js'
import { stateInput, Type } from '../src/state-input.js'
import type { InputFields } from '../src/state-input.js'
import { validateState } from '../src/validate.js'

describe('stateInput / validateState consistency check', () => {
  /** Builds a controller whose single route uses the given fields and schemas. */
  function build(fields: InputFields, ...schemas: Record<string, unknown>[]) {
    class CheckedController {
      async handle() {}
    }
    const descriptor = Object.getOwnPropertyDescriptor(CheckedController.prototype, 'handle')!
    // Applied bottom-up, like stacked decorators: @post, @stateInput, @validateState...
    for (const schema of [...schemas].reverse()) validateState(schema)(CheckedController.prototype, 'handle', descriptor)
    stateInput(fields)(CheckedController.prototype, 'handle', descriptor as any)
    post('/:id')(CheckedController.prototype, 'handle', descriptor)
    controller('/checked')(CheckedController)
    return CheckedController
  }
  const load = (...args: Parameters<typeof build>) => () => loadRouter({ controllerConstructors: [build(...args)] })

  const fields = {
    id: Type.Number({ from: 'params', required: true }),
    name: Type.String({ required: true }),
    page: Type.Number({ from: 'query' }),
  }
  const matching = {
    type: 'object',
    required: ['id', 'name'],
    properties: { id: { type: 'integer' }, name: { type: 'string', minLength: 1 }, page: { type: 'integer' } },
  }

  it('should accept a schema that matches the fields', () => {
    assert.doesNotThrow(load(fields, matching))
  })

  it('should accept @stateInput without @validateState', () => {
    assert.doesNotThrow(load(fields))
  })

  it('should reject a field that the schema does not cover', () => {
    const { page: _page, ...properties } = matching.properties
    assert.throws(load(fields, { ...matching, properties }), {
      name: 'TypeError',
      message: 'CheckedController.handle: @stateInput and @validateState do not match:\n' +
        '  - "page" is a @stateInput field but is not in the @validateState schema, so it is never checked or converted',
    })
  })

  it('should reject a schema property that is not a field', () => {
    assert.throws(
      load(fields, { ...matching, properties: { ...matching.properties, extra: { type: 'string' } } }),
      /"extra" is in the @validateState schema but is not a @stateInput field, so it can never have a value/
    )
    assert.throws(
      load(fields, { ...matching, required: ['id', 'name', 'token'] }),
      /"token" is in the @validateState schema but is not a @stateInput field/
    )
  })

  it('should reject a type the field does not declare', () => {
    assert.throws(
      load(fields, { ...matching, properties: { ...matching.properties, id: { type: 'string' } } }),
      /"id" is declared as number in @stateInput, but the @validateState schema allows string/
    )
    assert.throws(
      load(fields, { ...matching, properties: { ...matching.properties, name: { type: ['string', 'null'] } } }),
      /"name" is declared as string in @stateInput, but the @validateState schema allows null/
    )
  })

  it('should reject a required field that the schema does not require', () => {
    assert.throws(
      load(fields, { ...matching, required: ['id'] }),
      /"name" is required in @stateInput but not in the @validateState schema, so it may be missing/
    )
  })

  it('should report every problem at once', () => {
    assert.throws(load(fields, { type: 'object', properties: { id: { type: 'boolean' }, other: {} } }), (error: Error) => {
      assert.equal(error.message.split('\n').length, 6)
      return true
    })
  })

  it('should accept compatible types', () => {
    const wide = {
      id: Type.Union([Type.String(), Type.Number()], { required: true }),
      kind: Type.Enum(['a', 'b']),
      flag: Type.Enum(['x', 1]),
      tags: Type.Array(Type.String()),
      meta: Type.Object({ a: Type.String() }),
    }
    assert.doesNotThrow(load(wide, {
      type: 'object',
      required: ['id'],
      properties: {
        id: { type: 'integer' },
        kind: { enum: ['a', 'b'] },
        flag: { type: 'string' },
        tags: { type: 'array', items: { type: 'number' } },
        meta: { type: 'object' },
      },
    }))
  })

  it('should allow the schema to require a field that is optional in @stateInput', () => {
    assert.doesNotThrow(load(fields, { ...matching, required: ['id', 'name', 'page'] }))
  })

  it('should combine several schemas on one method', () => {
    assert.doesNotThrow(load(
      fields,
      { type: 'object', required: ['id'], properties: { id: { type: 'integer' } } },
      { type: 'object', required: ['name'], properties: { name: { type: 'string' }, page: { type: 'integer' } } }
    ))
  })

  it('should not check a schema that uses a combinator at its root', () => {
    const oneOf = {
      oneOf: [
        { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
        { type: 'object', properties: { id: { type: 'integer' }, unknown: { type: 'string' } } },
      ],
    }
    assert.doesNotThrow(load(fields, oneOf))
    // A comparable schema next to it is still checked for what can be judged...
    assert.throws(load(fields, oneOf, { type: 'object', properties: { id: { type: 'boolean' } } }), /"id" is declared as number/)
    // ...but not for coverage, which the other schema may provide.
    assert.doesNotThrow(load(fields, oneOf, { type: 'object', properties: { id: { type: 'integer' } } }))
  })
})
