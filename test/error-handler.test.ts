import 'mocha'
import { strict as assert } from 'assert'
import { errorHandlerMW } from '../src/error-handler.js'
import { Context } from 'koa'

describe('error-handler test suite', () => {
  it('should catch error and set 500 status with body', async () => {
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
    assert.deepEqual(ctx.body, { error: 'something broke' })
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
    assert.deepEqual(ctx.body, { error: 'unknown error' })
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
})
