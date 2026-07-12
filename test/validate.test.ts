import 'mocha'
import { strict as assert } from 'assert'
import _Ajv from 'ajv'
import * as router from '../src/router.js'
import { validate, validateState } from '../src/validate.js'

describe('validate test suite', () => {
  it('should reject when @validate fails on missing required property', async () => {
    @router.controller()
    class FakeController {
      @router.get('getFunc')
      @validate({
        type: 'object',
        required: ['requiredProperty'],
      })
      async getFunc() {
        throw new Error('Should not enter here')
      }
    }
    
    const koaRouter = router.loadRouter({ controllerConstructors: [FakeController] })
    const ctx: any = {
      method: 'GET',
      path: '/getFunc',
      headers: {},
      query: {},
      request: { body: {} },
    }
    await assert.rejects(koaRouter.routes()(ctx, (() => {}) as any), {
      message: '/ must have required property \'requiredProperty\''
    })
  })

  it('should pass when @validate succeeds', async () => {
    let handlerCalled = false
    @router.controller()
    class FakeController {
      @router.get('getFunc')
      @validate({
        type: 'object',
        required: ['key'],
        properties: {
          key: { type: 'string' },
        },
      })
      async getFunc() {
        handlerCalled = true
        return 'ok'
      }
    }
    
    const koaRouter = router.loadRouter({ controllerConstructors: [FakeController] })
    const ctx: any = {
      method: 'GET',
      path: '/getFunc',
      key: 'value',
      headers: {},
      query: {},
      request: { body: {} },
    }
    await koaRouter.routes()(ctx, (() => {}) as any)
    assert.ok(handlerCalled)
    assert.equal(ctx.body, 'ok')
  })

  it('should support custom Ajv instance with @validate', async () => {
    let handlerCalled = false
    const customAjv = new (_Ajv as any)({ coerceTypes: false }) // no coercion

    @router.controller()
    class FakeController {
      @router.get('getFunc')
      @validate({
        type: 'object',
        required: ['count'],
        properties: {
          count: { type: 'integer' },
        },
      }, { ajv: customAjv })
      async getFunc() {
        handlerCalled = true
      }
    }
    
    const koaRouter = router.loadRouter({ controllerConstructors: [FakeController] })
    const ctx: any = {
      method: 'GET',
      path: '/getFunc',
      count: '5', // string, should fail with coerceTypes: false
      headers: {},
      query: {},
      request: { body: {} },
    }
    await assert.rejects(koaRouter.routes()(ctx, (() => {}) as any))
    assert.equal(handlerCalled, false)
  })

  it('should support custom Ajv instance with @validateState', async () => {
    let handlerCalled = false
    const customAjv = new (_Ajv as any)({ coerceTypes: false })

    @router.controller()
    class FakeController {
      @router.get('getFunc')
      @validateState({
        type: 'object',
        required: ['count'],
        properties: {
          count: { type: 'integer' },
        },
      }, { ajv: customAjv })
      async getFunc() {
        handlerCalled = true
      }
    }
    
    const koaRouter = router.loadRouter({ controllerConstructors: [FakeController] })
    const ctx: any = {
      method: 'GET',
      path: '/getFunc',
      headers: {},
      query: {},
      state: { count: '5' }, // validateState checks ctx.state, not ctx.request.body
    }
    await assert.rejects(koaRouter.routes()(ctx, (() => {}) as any))
    assert.equal(handlerCalled, false)
  })
})
