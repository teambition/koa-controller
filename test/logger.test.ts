import 'mocha'
import { strict as assert } from 'assert'
import { loggerMW } from '../src/logger.js'

const noop = () => {}

describe('logger test suite', () => {
  it('should log request info on success', async () => {
    const logs: any[] = []
    const logger = { info: (...args: any[]) => logs.push(args), debug: noop, warn: noop, error: noop }
    const mw = loggerMW({ logger })

    const ctx: any = {
      status: 200,
      method: 'GET',
      routerName: 'TestController/getFunc',
      originalUrl: '/api/test',
      get: () => 'mocha-agent',
    }
    const next = async () => { ctx.status = 200 }

    await mw(ctx, next)
    assert.equal(logs.length, 1)
    const data = logs[0][0]
    assert.equal(data.status, 200)
    assert.equal(data.method, 'GET')
    assert.equal(data.routerName, 'TestController/getFunc')
    assert.ok(data.duration >= 0)
    assert.equal(data.url, '/api/test')
    assert.equal(data.userAgent, 'mocha-agent')
  })

  it('should log error status codes too', async () => {
    const logs: any[] = []
    const logger = { info: (...args: any[]) => logs.push(args), debug: noop, warn: noop, error: noop }
    const mw = loggerMW({ logger })

    const ctx: any = {
      status: 500,
      method: 'POST',
      routerName: 'TestController/postFunc',
      originalUrl: '/api/error',
      get: () => 'mocha-agent',
    }
    const next = async () => { ctx.status = 500 }

    await mw(ctx, next)
    assert.equal(logs.length, 1)
    assert.equal(logs[0][0].status, 500)
  })

  it('should use "unknown" when routerName is missing', async () => {
    const logs: any[] = []
    const logger = { info: (...args: any[]) => logs.push(args), debug: noop, warn: noop, error: noop }
    const mw = loggerMW({ logger })

    const ctx: any = {
      status: 200,
      method: 'GET',
      originalUrl: '/test',
      get: () => 'agent',
    }
    const next = async () => {}

    await mw(ctx, next)
    assert.equal(logs[0][0].routerName, 'unknown')
  })

  it('should skip logging when skipLogger is true', async () => {
    const logs: any[] = []
    const logger = { info: (...args: any[]) => logs.push(args), debug: noop, warn: noop, error: noop }
    const mw = loggerMW({ logger })

    const ctx: any = {
      skipLogger: true,
      status: 200,
      method: 'GET',
      originalUrl: '/test',
      get: () => 'agent',
    }
    const next = async () => {}

    await mw(ctx, next)
    assert.equal(logs.length, 0)
  })

  it('should call inject function to transform log data', async () => {
    const logs: any[] = []
    const logger = { info: (...args: any[]) => logs.push(args), debug: noop, warn: noop, error: noop }
    const mw = loggerMW({
      logger,
      inject: (data, ctx) => ({
        ...data,
        customField: 'injected',
        requestId: '123',
      }),
    })

    const ctx: any = {
      status: 200,
      method: 'GET',
      originalUrl: '/test',
      get: () => 'agent',
    }
    const next = async () => {}

    await mw(ctx, next)
    assert.equal(logs[0][0].customField, 'injected')
    assert.equal(logs[0][0].requestId, '123')
  })

  it('should survive inject function throwing', async () => {
    const logs: any[] = []
    const logger = { info: (...args: any[]) => logs.push(args), debug: noop, warn: noop, error: noop }
    const mw = loggerMW({
      logger,
      inject: () => { throw new Error('inject failed') },
    })

    const ctx: any = {
      status: 200,
      method: 'GET',
      originalUrl: '/test',
      get: () => 'agent',
    }
    const next = async () => {}

    // Should not throw
    await mw(ctx, next)
    assert.equal(logs.length, 1)
    // Should still log basic info
    assert.equal(logs[0][0].status, 200)
  })

  it('should work without logger (no-op, no crash)', async () => {
    const mw = loggerMW()

    const ctx: any = {
      status: 200,
      method: 'GET',
      originalUrl: '/test',
      get: () => 'agent',
    }
    const next = async () => {}

    await mw(ctx, next)
    // No assertion needed — just checking no crash
  })
  it('should redact sensitive query parameters in the logged url', async () => {
    const logs: any[] = []
    const logger: any = { info: (data: any) => logs.push(data) }
    const ctx: any = {
      status: 200,
      method: 'GET',
      originalUrl: '/callback?access_token=abc&state=xyz&trace=1',
      get: () => '',
    }
    await loggerMW({ logger })(ctx, async () => {})
    await loggerMW({ logger, redactQuery: ['state'] })(ctx, async () => {})
    assert.equal(logs[0].url, '/callback?access_token=[REDACTED]&state=xyz&trace=1')
    assert.equal(logs[1].url, '/callback?access_token=[REDACTED]&state=[REDACTED]&trace=1')
  })
})
