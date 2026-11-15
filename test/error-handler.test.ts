import 'mocha'
import { strict as assert } from 'assert'
import { errorHandlerMW } from '../src/error-handler.js'
import type { Context } from 'koa'

describe('error-handler test suite', () => {
  it('should catch error and set 500 status without leaking the message', async () => {
    const mw = errorHandlerMW()

    const ctx: any = {
      status: 404,
      method: 'GET',
      url: '/test',
      headers: {},
      request: { body: { foo: 'bar' } },
    }
    let called = false
    const next = async () => {
      called = true
      const err: any = new Error('something broke')
      err.status = 500
      throw err
    }

    await mw(ctx, next)
    assert.ok(called)
    assert.equal(ctx.status, 500)
    assert.deepEqual(ctx.body, { error: 'Internal Server Error' })
  })

  it('should catch error without status and default to 500', async () => {
    const mw = errorHandlerMW()

    const ctx: any = {
      status: 404,
      method: 'GET',
      url: '/test',
      headers: {},
      request: { body: {} },
    }
    const next = async () => {
      throw new Error('unknown error')
    }

    await mw(ctx, next)
    assert.equal(ctx.status, 500)
    assert.deepEqual(ctx.body, { error: 'Internal Server Error' })
  })

  it('should preserve error status for 4xx errors', async () => {
    const mw = errorHandlerMW()

    const ctx: any = {
      status: 404,
      method: 'GET',
      url: '/test',
      headers: {},
      request: { body: {} },
    }
    const next = async () => {
      const err: any = new Error('not found')
      err.status = 404
      throw err
    }

    await mw(ctx, next)
    assert.equal(ctx.status, 404)
    assert.deepEqual(ctx.body, { error: 'not found' })
  })

  it('should log 5xx errors when logger is provided', async () => {
    const logs: any[] = []
    const logger = { error: (...args: any[]) => logs.push(args) }
    const mw = errorHandlerMW({ logger })

    const ctx: any = {
      status: 404,
      method: 'POST',
      url: '/api/test',
      headers: { 'content-type': 'application/json' },
      request: { body: { key: 'val' } },
    }
    const next = async () => {
      const err: any = new Error('server error')
      err.status = 500
      throw err
    }

    await mw(ctx, next)
    assert.equal(logs.length, 1)
    const logged = logs[0][0]
    assert.equal(logged.method, 'POST')
    assert.equal(logged.url, '/api/test')
    assert.equal(logged.message, 'server error')
  })

  it('should NOT log 4xx errors even with logger', async () => {
    const logs: any[] = []
    const logger = { error: (...args: any[]) => logs.push(args) }
    const mw = errorHandlerMW({ logger })

    const ctx: any = {
      status: 404,
      method: 'GET',
      url: '/test',
      headers: {},
      request: { body: {} },
    }
    const next = async () => {
      const err: any = new Error('bad request')
      err.status = 400
      throw err
    }

    await mw(ctx, next)
    assert.equal(logs.length, 0)
  })

  it('should pass through when no error', async () => {
    const mw = errorHandlerMW()

    const ctx: any = {
      status: 200,
      method: 'GET',
      url: '/test',
      headers: {},
      request: { body: {} },
      body: { ok: true },
    }
    let called = false
    const next = async () => {
      called = true
    }

    await mw(ctx, next)
    assert.ok(called)
    assert.equal(ctx.status, 200)
    assert.deepEqual(ctx.body, { ok: true })
  })

  it('should work without logger option', async () => {
    // No options at all
    const mw = errorHandlerMW()

    const ctx: any = {
      status: 404,
      method: 'GET',
      url: '/test',
      headers: {},
      request: { body: {} },
    }
    const next = async () => {
      throw new Error('test')
    }

    // Should not throw
    await mw(ctx, next)
    assert.equal(ctx.status, 500)
  })

  describe('response message', () => {
    async function run(error: unknown) {
      const ctx: any = { status: 404, method: 'GET', url: '/test', headers: {}, request: { body: {} } }
      await errorHandlerMW()(ctx, async () => { throw error })
      return ctx
    }

    it('should use the status text for 5xx statuses other than 500', async () => {
      const ctx = await run(Object.assign(new Error('upstream db-1 timed out'), { status: 503 }))
      assert.equal(ctx.status, 503)
      assert.deepEqual(ctx.body, { error: 'Service Unavailable' })
    })

    it('should send the message of a 5xx error marked expose', async () => {
      const ctx = await run(Object.assign(new Error('maintenance until 10:00'), { status: 503, expose: true }))
      assert.deepEqual(ctx.body, { error: 'maintenance until 10:00' })
    })

    it('should hide the message of a 4xx error marked not to expose', async () => {
      const ctx = await run(Object.assign(new Error('user 42 is banned'), { status: 403, expose: false }))
      assert.equal(ctx.status, 403)
      assert.deepEqual(ctx.body, { error: 'Forbidden' })
    })

    it('should hide the message of a thrown non-error value', async () => {
      const ctx = await run('raw failure detail')
      assert.equal(ctx.status, 500)
      assert.deepEqual(ctx.body, { error: 'Internal Server Error' })
    })
  })

  describe('log entry', () => {
    function setup(options: Parameters<typeof errorHandlerMW>[0] = {}) {
      const logs: any[] = []
      const logger = { error: (...args: any[]) => logs.push(args[0]) }
      const ctx: any = {
        status: 404,
        method: 'POST',
        url: '/api/login?token=abc123&page=2',
        headers: {
          Authorization: 'Bearer secret-token',
          cookie: 'sid=secret-session',
          'x-internal-secret': 'internal',
          'content-type': 'application/json',
        },
        request: { body: { password: 'hunter2' } },
      }
      const run = () => errorHandlerMW({ logger, ...options })(ctx, async () => { throw new Error('boom') })
      return { logs, ctx, run }
    }

    it('should redact sensitive headers and query parameters', async () => {
      const { logs, ctx, run } = setup()
      await run()
      assert.equal(logs[0].message, 'boom')
      assert.equal(logs[0].url, '/api/login?token=[REDACTED]&page=2')
      assert.deepEqual(logs[0].headers, {
        Authorization: '[REDACTED]',
        cookie: '[REDACTED]',
        'x-internal-secret': 'internal',
        'content-type': 'application/json',
      })
      // the request itself is left untouched
      assert.equal(ctx.headers.Authorization, 'Bearer secret-token')
    })

    it('should not log the request body by default', async () => {
      const { logs, run } = setup()
      await run()
      assert.ok(!('reqBody' in logs[0]))
      assert.ok(!JSON.stringify({ ...logs[0] }).includes('hunter2'))
    })

    it('should log the request body when logBody is enabled', async () => {
      const { logs, run } = setup({ logBody: true })
      await run()
      assert.equal(logs[0].reqBody, '{"password":"hunter2"}')
    })

    it('should redact additional header and query names', async () => {
      const { logs, run } = setup({ redactHeaders: ['X-Internal-Secret'], redactQuery: ['page'] })
      await run()
      assert.equal(logs[0].headers['x-internal-secret'], '[REDACTED]')
      assert.equal(logs[0].url, '/api/login?token=[REDACTED]&page=[REDACTED]')
    })

    it('should log the value built by serialize', async () => {
      const { logs, run } = setup({
        serialize: (error, ctx) => ({ msg: error.message, method: ctx.method }),
      })
      await run()
      assert.deepEqual(logs[0], { msg: 'boom', method: 'POST' })
    })

    it('should fall back to the default entry when serialize throws', async () => {
      const { logs, run } = setup({ serialize: () => { throw new Error('serialize failed') } })
      await run()
      assert.equal(logs[0].message, 'boom')
      assert.equal(logs[0].headers.cookie, '[REDACTED]')
    })
  })
})
