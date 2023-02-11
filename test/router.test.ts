import 'mocha'
import { strict as assert } from 'assert'
import * as router from '../src/router'
import { Context } from 'koa'

describe('http-server router test suite', () => {
  it('router sequence', async () => {
    let sequence = 0
    @router.controller()
    @router.before(async (ctx) => {
      assert.equal(sequence++, 0)
    })
    @router.before(async (ctx) => {
      assert.equal(sequence++, 1)
    })
    @router.after(async (ctx) => {
      assert.equal(sequence++, 11)
    })
    @router.after(async (ctx) => {
      assert.equal(sequence++, 12)
    })
    @router.middleware(async (ctx, next) => {
      assert.equal(sequence++, 2)
      return next()
    })
    @router.middleware(async (ctx, next) => {
      assert.equal(sequence++, 3)
      return next()
    })
    class FakeController {
      @router.get('getFunc')
      @router.before(async (ctx) => {
        assert.equal(sequence++, 4)
      })
      @router.before(async (ctx) => {
        assert.equal(sequence++, 5)
      })
      @router.after(async (ctx) => {
        assert.equal(sequence++, 9)
      })
      @router.after(async (ctx) => {
        assert.equal(sequence++, 10)
      })
      @router.middleware(async (ctx, next) => {
        assert.equal(sequence++, 6)
        return next()
      })
      @router.middleware(async (ctx, next) => {
        assert.equal(sequence++, 7)
        return next()
      })
      async getFunc(_, ctx: Context) {
        assert.equal(sequence++, 8)
      }
    }
    
    const koaRouter = router.getRouter({ controllerConstructors: [FakeController] })
    const ctx: any = {
      method: 'GET',
      path: '/getFunc',
      headers: {},
      query: {},
      request: { body: {
        k1: 'v1',
        k2: 'v2',
      } },
    }
    // eslint-disable-next-line @typescript-eslint/no-empty-function
    await koaRouter.routes()(ctx, (() => {}) as any)
  })

  it('router multi method or path', async () => {
    let callCount = 0
    @router.controller('/a1')
    @router.controller('/a2')
    class FakeController {
      @router.request('get', '/b')
      @router.request('post', '/c')
      @router.request('post', '/d')
      async multiMethod(state, ctx) {
        callCount++
      }
    }

    const koaRouter = router.getRouter({ controllerConstructors: [FakeController] })
    const uris = [
      'GET /a1/b',
      'POST /a1/c',
      'POST /a1/d',
      'GET /a2/b',
      'POST /a2/c',
      'POST /a2/d',
    ]

    for (const idx in uris) {
      const [method, path] = uris[idx].split(' ')
      const ctx1: any = {
        method,
        path,
        headers: {},
        query: {},
        request: { body: { } },
      }
      // eslint-disable-next-line @typescript-eslint/no-empty-function
      await koaRouter.routes()(ctx1, (() => {}) as any)
      assert.equal(callCount, Number(idx) + 1)
    }
  })
})
