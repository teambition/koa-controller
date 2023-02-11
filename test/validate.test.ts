import 'mocha'
import { strict as assert } from 'assert'
import * as router from '../src/router'
import { validate } from '../src/validate'
import { Context } from 'koa'

describe('http-server router test suite', () => {
  it('decorator validator', async () => {
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
    
    const koaRouter = router.getRouter({ controllerConstructors: [FakeController] })
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
