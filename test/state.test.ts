import 'mocha'
import { strict as assert } from 'assert'
import * as router from '../src/router.js'
import { state } from '../src/state.js'
import { validateState } from '../src/validate.js'

describe('state test suite', () => {
  it('should map state keys from ctx paths with @state(kvMap)', async () => {
    let capturedState: any
    @router.controller()
    class FakeController {
      @router.get('getFunc')
      @state({
        queryKey: ['query.key'],
        bodyKey: ['request.body.key'],
      })
      async getFunc(state) {
        capturedState = state
      }
    }
    
    const koaRouter = router.loadRouter({ controllerConstructors: [FakeController] })
    const ctx: any = {
      method: 'GET',
      path: '/getFunc',
      headers: {},
      query: {},
      request: { body: { key: 'correct', key2: 'other' } },
    }
    await koaRouter.routes()(ctx, (() => {}) as any)

    assert.ok(capturedState)
    assert.equal(capturedState.queryKey, undefined)
    assert.equal(capturedState.bodyKey, 'correct')
    assert.equal(capturedState.otherKey, undefined)
  })

  it('should merge query, body and params with @state() (null)', async () => {
    let capturedState: any
    @router.controller()
    class FakeController {
      @router.get('getFunc')
      @state(null)
      async getFunc(state) {
        capturedState = state
      }
    }
    
    const koaRouter = router.loadRouter({ controllerConstructors: [FakeController] })
    const ctx: any = {
      method: 'GET',
      path: '/getFunc',
      headers: {},
      query: { q: 'queryVal' },
      params: { id: '123' },
      request: { body: { key: 'correct', key2: 'other' } },
    }
    await koaRouter.routes()(ctx, (() => {}) as any)

    assert.ok(capturedState)
    assert.equal(capturedState.q, 'queryVal')
    assert.equal(capturedState.id, '123')
    assert.equal(capturedState.key, 'correct')
    assert.equal(capturedState.key2, 'other')
  })

  it('should support nested path lookup via lodash.get', async () => {
    let capturedState: any
    @router.controller()
    class FakeController {
      @router.get('getFunc')
      @state({
        nested: ['request.body.deeply.nested.key'],
      })
      async getFunc(state) {
        capturedState = state
      }
    }
    
    const koaRouter = router.loadRouter({ controllerConstructors: [FakeController] })
    const ctx: any = {
      method: 'GET',
      path: '/getFunc',
      headers: {},
      query: {},
      request: { body: { deeply: { nested: { key: 'deepValue' } } } },
    }
    await koaRouter.routes()(ctx, (() => {}) as any)

    assert.equal(capturedState.nested, 'deepValue')
  })

  it('should use first matching fromPath value', async () => {
    let capturedState: any
    @router.controller()
    class FakeController {
      @router.get('getFunc')
      @state({
        val: ['query.missing', 'request.body.found'],
      })
      async getFunc(state) {
        capturedState = state
      }
    }
    
    const koaRouter = router.loadRouter({ controllerConstructors: [FakeController] })
    const ctx: any = {
      method: 'GET',
      path: '/getFunc',
      headers: {},
      query: {},
      request: { body: { found: 'fallback-value' } },
    }
    await koaRouter.routes()(ctx, (() => {}) as any)

    // first path 'query.missing' is undefined, second path 'request.body.found' has value
    assert.equal(capturedState.val, 'fallback-value')
  })

  it('should map state from URL path params', async () => {
    let capturedState: any
    @router.controller()
    class FakeController {
      @router.get('getFunc')
      @state({
        userId: ['params.id'],
      })
      async getFunc(state) {
        capturedState = state
      }
    }
    
    const koaRouter = router.loadRouter({ controllerConstructors: [FakeController] })
    const ctx: any = {
      method: 'GET',
      path: '/getFunc',
      headers: {},
      query: {},
      params: { id: '42' },
      request: { body: {} },
    }
    await koaRouter.routes()(ctx, (() => {}) as any)

    assert.equal(capturedState.userId, '42')
  })

  it('should validate state with @validateState (success)', async () => {
    let capturedState: any
    @router.controller()
    class FakeController {
      @router.get('getFunc')
      @state(null)
      @validateState({
        type: 'object',
        required: ['key'],
        properties: {
          key3: { type: 'integer' },
        },
      })
      async getFunc(state) {
        capturedState = state
      }
    }
    
    const koaRouter = router.loadRouter({ controllerConstructors: [FakeController] })
    const ctx: any = {
      method: 'GET',
      path: '/getFunc',
      headers: {},
      query: {},
      request: { body: { key: 'correct', key2: 'other', key3: '123' } },
    }
    await koaRouter.routes()(ctx, (() => {}) as any)

    assert.ok(capturedState)
    assert.equal(capturedState.key, 'correct')
    assert.equal(capturedState.key2, 'other')
    assert.equal(capturedState.key3, 123) // coerced to integer
  })

  it('should reject with @validateState when required field missing', async () => {
    @router.controller()
    class FakeController {
      @router.get('getFunc')
      @state(null)
      @validateState({
        type: 'object',
        required: ['key'],
        properties: {
          key3: { type: 'integer' },
        },
      })
      async getFunc(state) {}
    }
    
    const koaRouter = router.loadRouter({ controllerConstructors: [FakeController] })
    const ctx: any = {
      method: 'GET',
      path: '/getFunc',
      headers: {},
      query: {},
      request: { body: { } },
    }
    await assert.rejects(koaRouter.routes()(ctx, (() => {}) as any), {
      message: '/ must have required property \'key\''
    })
  })
})
