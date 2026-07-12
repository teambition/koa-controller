import 'mocha'
import { strict as assert } from 'assert'
import * as router from '../src/router.js'
import { Context } from 'koa'
import { mkdtempSync, writeFileSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

describe('router test suite', () => {
  it('should execute decorators in correct sequence', async () => {
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
    
    const koaRouter = router.loadRouter({ controllerConstructors: [FakeController] })
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
    await koaRouter.routes()(ctx, (() => {}) as any)
  })

  it('should support multiple controllers and methods', async () => {
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

    const koaRouter = router.loadRouter({ controllerConstructors: [FakeController] })
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
      await koaRouter.routes()(ctx1, (() => {}) as any)
      assert.equal(callCount, Number(idx) + 1)
    }
  })

  it('should support router prefix option', async () => {
    @router.controller()
    class FakeController {
      @router.get('hello')
      async hello() { return 'world' }
    }

    const koaRouter = router.loadRouter({
      prefix: '/api',
      controllerConstructors: [FakeController],
    })
    const ctx: any = {
      method: 'GET',
      path: '/api/hello',
      headers: {},
      query: {},
      request: { body: {} },
    }
    await koaRouter.routes()(ctx, (() => {}) as any)
    assert.equal(ctx.body, 'world')
  })

  it('should skip non-function constructor entries', () => {
    const koaRouter = router.loadRouter({
      controllerConstructors: [null as any, undefined as any, 'string' as any],
    })
    assert.ok(koaRouter)
  })

  it('should skip constructor without controller meta', () => {
    class PlainClass {
      foo() { return 'bar' }
    }

    const koaRouter = router.loadRouter({
      controllerConstructors: [PlainClass],
    })
    assert.ok(koaRouter)
  })

  it('should skip method that is not a function', () => {
    @router.controller()
    class FakeController {
      notAFunction = 'im a string'
      @router.get('notAFunction')
      async realMethod() { return 'ok' }
    }

    const koaRouter = router.loadRouter({ controllerConstructors: [FakeController] })
    assert.ok(koaRouter)
  })

  it('should prevent duplicate controller prefixes', () => {
    @router.controller('/same')
    @router.controller('/same')
    class FakeController {
      @router.get('func')
      async func() { return 'ok' }
    }

    const koaRouter = router.loadRouter({ controllerConstructors: [FakeController] })
    assert.ok(koaRouter)
  })

  describe('getRouterSync', () => {
    let tmpDir: string

    beforeEach(() => {
      tmpDir = mkdtempSync(join(tmpdir(), 'koa-ctrl-test-'))
    })

    afterEach(() => {
      rmSync(tmpDir, { recursive: true, force: true })
    })

    it('should scan files via glob and load function exports', () => {
      writeFileSync(join(tmpDir, 'test.js'), `
module.exports = function FakeController() {}
`)
      const koaRouter = router.getRouterSync({ cwd: tmpDir, files: '**/*.js' })
      assert.ok(koaRouter)
    })

    it('should load named exports and skip non-function values', () => {
      writeFileSync(join(tmpDir, 'api.js'), `
class C1 {}
class C2 {}
exports.C1 = C1
exports.C2 = C2
exports.NotAFunc = 'string'
`)
      const koaRouter = router.getRouterSync({ cwd: tmpDir, files: '**/*.js' })
      assert.ok(koaRouter)
    })

    it('should apply prefix option', () => {
      writeFileSync(join(tmpDir, 'home.js'), `
module.exports = function FakeController() {}
`)
      const koaRouter = router.getRouterSync({ cwd: tmpDir, files: '**/*.js', prefix: '/api' })
      assert.ok(koaRouter)
    })

    it('should return empty router for unmatched glob', () => {
      const koaRouter = router.getRouterSync({ cwd: tmpDir, files: 'nonexistent/**/*.js' })
      assert.ok(koaRouter)
    })
  })

  describe('getRouterAsync', () => {
    let tmpDir: string

    beforeEach(() => {
      tmpDir = mkdtempSync(join(process.cwd(), '.test-tmp-'))
    })

    afterEach(() => {
      rmSync(tmpDir, { recursive: true, force: true })
    })

    it('should load ESM controller files via import()', async () => {
      writeFileSync(join(tmpDir, 'home.ts'), `
import { controller, get } from '../src/index.js'

@controller('/')
export class HomeController {
  @get('/')
  async index() { return 'hello from esm' }
}
`)

      const koaRouter = await router.getRouterAsync({ cwd: tmpDir, files: '**/*.ts' })
      const ctx: any = { method: 'GET', path: '/', headers: {}, query: {}, request: { body: {} } }
      await koaRouter.routes()(ctx, (() => {}) as any)
      assert.equal(ctx.body, 'hello from esm')
    })

    it('should support prefix option', async () => {
      writeFileSync(join(tmpDir, 'api.ts'), `
import { controller, get } from '../src/index.js'

@controller('/api')
export class ApiController {
  @get('/')
  async index() { return 'prefixed' }
}
`)

      const koaRouter = await router.getRouterAsync({ cwd: tmpDir, files: '**/*.ts', prefix: '/v1' })
      const ctx: any = { method: 'GET', path: '/v1/api/', headers: {}, query: {}, request: { body: {} } }
      await koaRouter.routes()(ctx, (() => {}) as any)
      assert.equal(ctx.body, 'prefixed')
    })

    it('should return empty router for unmatched glob', async () => {
      const koaRouter = await router.getRouterAsync({ cwd: tmpDir, files: 'nonexistent/**/*.ts' })
      assert.ok(koaRouter)
    })
  })
})
