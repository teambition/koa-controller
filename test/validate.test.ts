import 'mocha'
import { strict as assert } from 'assert'
import { KoaRouterManager } from '../src/router'
import { validate } from '../src/validate'
import { Context } from 'koa'

describe('http-server router test suite', () => {
  let router: KoaRouterManager
  beforeEach(() => {
    router = new KoaRouterManager()
  })

  it('decorator validator', async () => {
    @router.controller()

    class FakeController {
      @router.get('getFunc')
      @validate({
        type: 'object',
        required: ['requiredProperty'],
      }, { routerManager: router })
      async getFunc() {
        throw new Error('Should not enter here')
      }
    }
    
    const koaRouter = router.getRouter()
    const ctx: any = {
      method: 'GET',
      path: '/getFunc',
      headers: {},
      query: {},
      request: { body: {} },
    }
    const next: any = () => { }
    await assert.rejects(koaRouter.routes()(ctx, (() => {}) as any), {
      message: '/ must have required property \'requiredProperty\''
    })
  })
})
