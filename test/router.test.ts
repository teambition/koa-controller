import 'mocha'
import { strict as assert } from 'assert'
import * as router from '../src/router.js'
import type { Context } from 'koa'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import type { AddressInfo } from 'net'
import Koa from 'koa'

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
      async getFunc(_: unknown, ctx: Context) {
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
      async multiMethod(_state: unknown, _ctx: Context) {
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

  describe('response body', () => {
    async function requestApp(controllerConstructor: any, pathname: string) {
      const app = new Koa()
      app.use(router.loadRouter({ controllerConstructors: [controllerConstructor] }).routes())
      const server = app.listen(0)
      try {
        const { port } = server.address() as AddressInfo
        return await fetch(`http://127.0.0.1:${port}${pathname}`, { redirect: 'manual' })
      } finally {
        server.close()
      }
    }

    @router.controller('/body')
    class BodyController {
      @router.get('/returned')
      async returned() { return { from: 'return' } }

      @router.get('/assigned')
      async assigned(_: unknown, ctx: Context) { ctx.body = 'assigned by method' }

      @router.get('/redirect')
      async redirect(_: unknown, ctx: Context) { ctx.redirect('/elsewhere') }

      @router.get('/both')
      async both(_: unknown, ctx: Context) {
        ctx.body = 'assigned by method'
        return 'returned by method'
      }

      @router.get('/empty')
      async empty() {}
    }

    it('should use the returned value as the body', async () => {
      const res = await requestApp(BodyController, '/body/returned')
      assert.equal(res.status, 200)
      assert.deepEqual(await res.json(), { from: 'return' })
    })

    it('should keep a body assigned by the method when it returns nothing', async () => {
      const res = await requestApp(BodyController, '/body/assigned')
      assert.equal(res.status, 200)
      assert.equal(await res.text(), 'assigned by method')
    })

    it('should keep a redirect issued by the method', async () => {
      const res = await requestApp(BodyController, '/body/redirect')
      assert.equal(res.status, 302)
      assert.equal(res.headers.get('location'), '/elsewhere')
    })

    it('should prefer the returned value over an assigned body', async () => {
      const res = await requestApp(BodyController, '/body/both')
      assert.equal(await res.text(), 'returned by method')
    })

    it('should respond 204 when the method neither returns nor assigns a body', async () => {
      const res = await requestApp(BodyController, '/body/empty')
      assert.equal(res.status, 204)
    })
  })

  describe('controller inheritance', () => {
    async function call(koaRouter: ReturnType<typeof router.loadRouter>, method: string, path: string) {
      const ctx: any = { method, path, headers: {}, query: {}, request: { body: {} } }
      await koaRouter.routes()(ctx, (() => {}) as any)
      return ctx
    }

    it('should not add subclass routes to the parent controller', async () => {
      @router.controller('/parent')
      class ParentController {
        @router.get('/shared')
        async shared() { return 'shared' }
      }

      @router.controller('/child')
      class ChildController extends ParentController {
        @router.get('/own')
        async own() { return 'own' }
      }

      const parentRouter = router.loadRouter({ controllerConstructors: [ParentController] })
      assert.equal((await call(parentRouter, 'GET', '/parent/shared')).body, 'shared')
      assert.equal((await call(parentRouter, 'GET', '/parent/own')).body, undefined)
      assert.equal((await call(parentRouter, 'GET', '/child/own')).body, undefined)

      const childRouter = router.loadRouter({ controllerConstructors: [ChildController] })
      assert.equal((await call(childRouter, 'GET', '/child/own')).body, 'own')
    })

    it('should inherit parent routes under the subclass prefix only', async () => {
      @router.controller('/parent')
      class ParentController {
        @router.get('/shared')
        async shared() { return this.name() }
        name() { return 'parent' }
      }

      @router.controller('/child')
      class ChildController extends ParentController {
        name() { return 'child' }
      }

      const koaRouter = router.loadRouter({ controllerConstructors: [ParentController, ChildController] })
      assert.equal((await call(koaRouter, 'GET', '/parent/shared')).body, 'parent')
      assert.equal((await call(koaRouter, 'GET', '/child/shared')).body, 'child')
    })

    it('should not register a subclass that declares no prefix of its own', async () => {
      let instances = 0
      @router.controller('/parent')
      class ParentController {
        constructor() { instances++ }
        @router.get('/shared')
        async shared() { return 'shared' }
      }
      class ChildController extends ParentController {}

      const koaRouter = router.loadRouter({ controllerConstructors: [ChildController] })
      assert.equal(instances, 0)
      assert.equal((await call(koaRouter, 'GET', '/parent/shared')).body, undefined)
    })

    it('should run parent middlewares around subclass middlewares', async () => {
      const sequence: string[] = []
      @router.controller('/parent')
      @router.before(async () => { sequence.push('parent before') })
      @router.after(async () => { sequence.push('parent after') })
      class ParentController {
        @router.get('/shared')
        @router.before(async () => { sequence.push('parent method before') })
        async shared() { sequence.push('method') }
      }

      @router.controller('/child')
      @router.before(async () => { sequence.push('child before') })
      @router.after(async () => { sequence.push('child after') })
      class ChildController extends ParentController {}

      const childRouter = router.loadRouter({ controllerConstructors: [ChildController] })
      await call(childRouter, 'GET', '/child/shared')
      assert.deepEqual(sequence, [
        'parent before',
        'child before',
        'parent method before',
        'method',
        'child after',
        'parent after',
      ])

      sequence.length = 0
      const parentRouter = router.loadRouter({ controllerConstructors: [ParentController] })
      await call(parentRouter, 'GET', '/parent/shared')
      assert.deepEqual(sequence, ['parent before', 'parent method before', 'method', 'parent after'])
    })
  })

  it('should store controller metadata under a globally registered symbol', () => {
    @router.controller('/symbol')
    class FakeController {
      @router.get('/')
      async index() {}
    }
    assert.ok(Object.getOwnPropertySymbols(FakeController).includes(Symbol.for('@tng/koa-controller:controller')))
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

    it('should load files in ascending path order', () => {
      const loaded: string[] = []
      ;(globalThis as any).__koaControllerLoadOrder = loaded
      mkdirSync(join(tmpDir, 'sub'))
      for (const name of ['user', 'c', '10-z', 'b', 'admin', '02-b', 'a', 'sub/x', '01-a', 'Zeta', 'sub-y']) {
        writeFileSync(join(tmpDir, `${name}.js`), `globalThis.__koaControllerLoadOrder.push(${JSON.stringify(name)})`)
      }
      try {
        router.getRouterSync({ cwd: tmpDir, files: '**/*.js' })
      } finally {
        delete (globalThis as any).__koaControllerLoadOrder
      }
      assert.deepEqual(loaded, ['01-a', '02-b', '10-z', 'Zeta', 'a', 'admin', 'b', 'c', 'sub-y', 'sub/x', 'user'])
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

it('should load files in ascending path order', async () => {
      const loaded: string[] = []
      ;(globalThis as any).__koaControllerLoadOrder = loaded
      mkdirSync(join(tmpDir, 'sub'))
      for (const name of ['user', 'c', '10-z', 'b', 'admin', '02-b', 'a', 'sub/x', '01-a', 'Zeta', 'sub-y']) {
        writeFileSync(join(tmpDir, `${name}.mjs`), `globalThis.__koaControllerLoadOrder.push(${JSON.stringify(name)})`)
      }
      try {
        await router.getRouterAsync({ cwd: tmpDir, files: '**/*.mjs' })
      } finally {
        delete (globalThis as any).__koaControllerLoadOrder
      }
      assert.deepEqual(loaded, ['01-a', '02-b', '10-z', 'Zeta', 'a', 'admin', 'b', 'c', 'sub-y', 'sub/x', 'user'])
    })

    it('should let file names decide which overlapping route matches', async () => {
      const source = (className: string, pathname: string, body: string) => `
import { controller, get } from '../src/index.js'

@controller('/users')
export class ${className} {
  @get('${pathname}')
  async handle() { return '${body}' }
}
`
      // Written in the opposite order to the one they must be loaded in.
      writeFileSync(join(tmpDir, '02-by-id.ts'), source('ByIdController', '/:id', 'by id'))
      writeFileSync(join(tmpDir, '01-me.ts'), source('MeController', '/me', 'me'))

      const koaRouter = await router.getRouterAsync({ cwd: tmpDir, files: '**/*.ts' })
      const request = async (path: string) => {
        const ctx: any = { method: 'GET', path, headers: {}, query: {}, request: { body: {} } }
        await koaRouter.routes()(ctx, (() => {}) as any)
        return ctx.body
      }
      assert.equal(await request('/users/me'), 'me')
      assert.equal(await request('/users/42'), 'by id')
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
