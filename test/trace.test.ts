import 'mocha'
import { strict as assert } from 'assert'
import { alsMW, traceMW } from '../src/trace.js'
import { AsyncLocalStorage } from 'async_hooks'
import { Tracer, FORMAT_HTTP_HEADERS, Tags, SpanContext, Span } from 'opentracing'

// A minimal mock tracer for testing
class MockSpan extends Span {
  _operationName = ''
  _tags: Record<string, any> = {}
  _finished = false
  _traceId = 'trace-123'

  protected _context(): SpanContext {
    return {
      toTraceId: () => this._traceId,
      toSpanId: () => 'span-456',
    } as any
  }

  protected _setOperationName(name: string): void {
    this._operationName = name
  }

  protected _addTags(tags: Record<string, any>): void {
    Object.assign(this._tags, tags)
  }

  protected _finish(): void {
    this._finished = true
  }

  _tracer(): Tracer {
    return mockTracer
  }
}

const mockTracer = new Tracer()

// Stub extract/startSpan on the prototype
const originalExtract = Tracer.prototype.extract
const originalStartSpan = Tracer.prototype.startSpan

describe('trace test suite', () => {
  let spans: MockSpan[]

  beforeEach(() => {
    spans = []
    Tracer.prototype.extract = function (_format: any, _headers: any) {
      return null as any
    }
    Tracer.prototype.startSpan = function (name: string, _options?: any) {
      const span = new (MockSpan as any)(name)
      spans.push(span)
      return span
    }
  })

  afterEach(() => {
    Tracer.prototype.extract = originalExtract
    Tracer.prototype.startSpan = originalStartSpan
  })

  describe('alsMW', () => {
    it('should run next within ALS context', async () => {
      const als = new AsyncLocalStorage()
      const mw = alsMW(als)

      const ctx: any = {}
      let storeInNext: any = undefined

      const next = async () => {
        storeInNext = als.getStore()
      }

      await mw(ctx, next)
      assert.ok(storeInNext !== undefined)
      assert.equal(typeof storeInNext, 'object')
    })

    it('should provide isolated store per request', async () => {
      const als = new AsyncLocalStorage()
      const mw = alsMW(als)

      const stores: any[] = []
      const ctx1: any = {}
      const ctx2: any = {}

      await mw(ctx1, async () => {
        (als.getStore() as any).id = 'req-1'
        stores.push(als.getStore())
      })
      await mw(ctx2, async () => {
        (als.getStore() as any).id = 'req-2'
        stores.push(als.getStore())
      })

      assert.equal(stores[0].id, 'req-1')
      assert.equal(stores[1].id, 'req-2')
    })
  })

  describe('traceMW', () => {
    it('should create a span for each request', async () => {
      const mw = traceMW(mockTracer)

      const ctx: any = {
        method: 'GET',
        url: '/api/test',
        status: 200,
        headers: {},
      }
      let called = false
      const next = async () => { called = true }

      await mw(ctx, next)

      assert.ok(called)
      assert.equal(spans.length, 1)
      assert.ok(ctx.span)
      assert.ok(ctx.traceId)
      assert.equal(ctx.traceId, 'trace-123')
    })

    it('should set operation name with method and routePath', async () => {
      const mw = traceMW(mockTracer)

      const ctx: any = {
        method: 'POST',
        url: '/api/data',
        routePath: '/api/data',
        status: 201,
        headers: {},
      }
      const next = async () => {}

      await mw(ctx, next)
      assert.equal(spans[0]._operationName, 'http-request POST /api/data')
    })

    it('should fall back to url when routePath is missing', async () => {
      const mw = traceMW(mockTracer)

      const ctx: any = {
        method: 'GET',
        url: '/some/path',
        status: 200,
        headers: {},
      }
      const next = async () => {}

      await mw(ctx, next)
      assert.equal(spans[0]._operationName, 'http-request GET /some/path')
    })

    it('should set HTTP tags on span', async () => {
      const mw = traceMW(mockTracer)

      const ctx: any = {
        method: 'DELETE',
        url: '/api/item',
        status: 204,
        headers: {},
      }
      const next = async () => {}

      await mw(ctx, next)
      assert.equal(spans[0]._tags[Tags.HTTP_STATUS_CODE], 204)
      assert.equal(spans[0]._tags[Tags.HTTP_METHOD], 'DELETE')
      assert.equal(spans[0]._tags[Tags.HTTP_URL], '/api/item')
    })

    it('should set ERROR tag when status >= 500', async () => {
      const mw = traceMW(mockTracer)

      const ctx: any = {
        method: 'GET',
        url: '/error',
        status: 500,
        headers: {},
      }
      const next = async () => {}

      await mw(ctx, next)
      assert.equal(spans[0]._tags[Tags.ERROR], true)
    })

    it('should NOT set ERROR tag when status < 500', async () => {
      const mw = traceMW(mockTracer)

      const ctx: any = {
        method: 'GET',
        url: '/ok',
        status: 200,
        headers: {},
      }
      const next = async () => {}

      await mw(ctx, next)
      assert.equal(spans[0]._tags[Tags.ERROR], undefined)
    })

    it('should finish span after request', async () => {
      const mw = traceMW(mockTracer)

      const ctx: any = {
        method: 'GET',
        url: '/test',
        status: 200,
        headers: {},
      }
      const next = async () => {}

      await mw(ctx, next)
      assert.ok(spans[0]._finished)
    })

    it('should extract parent span context from headers', async () => {
      // Override extract to return something
      let extracted = false
      Tracer.prototype.extract = function (format: any, headers: any) {
        extracted = true
        assert.equal(format, FORMAT_HTTP_HEADERS)
        return { toTraceId: () => 'parent-trace' } as any
      }

      const mw = traceMW(mockTracer)

      const ctx: any = {
        method: 'GET',
        url: '/test',
        status: 200,
        headers: { 'uber-trace-id': 'something' },
      }
      const next = async () => {}

      await mw(ctx, next)
      assert.ok(extracted)
    })

    it('should try zipkin headers when enabled and no parent span', async () => {
      let zipkinExtracted = false
      Tracer.prototype.extract = function (format: any, _headers: any) {
        if (format === 'ZIPKIN_HTTP_HEADERS') {
          zipkinExtracted = true
        }
        return null as any
      }

      const mw = traceMW(mockTracer, { zipkinHeaderEnable: true })

      const ctx: any = {
        method: 'GET',
        url: '/test',
        status: 200,
        headers: {},
      }
      const next = async () => {}

      await mw(ctx, next)
      assert.ok(zipkinExtracted)
    })

    it('should set span and traceId on ALS store when provided', async () => {
      const als = new AsyncLocalStorage<any>()
      const mw = traceMW(mockTracer, { als })

      const ctx: any = {
        method: 'GET',
        url: '/test',
        status: 200,
        headers: {},
      }
      let storeInNext: any = undefined
      const next = async () => {
        storeInNext = als.getStore()
      }

      // Wrap in alsMW so ALS store exists
      await alsMW(als)(ctx, async () => {
        await mw(ctx, next)
      })

      assert.ok(storeInNext)
      assert.ok(storeInNext.span)
      assert.equal(storeInNext.traceId, 'trace-123')
    })

    it('should generate randomUUID when span has no traceId', async () => {
      // Override startSpan to create a span with no toTraceId
      Tracer.prototype.startSpan = function (name: string, _options?: any) {
        const span = new (MockSpan as any)(name)
        span._traceId = '' // empty, falsy
        spans.push(span)
        return span
      }

      const mw = traceMW(mockTracer)

      const ctx: any = {
        method: 'GET',
        url: '/test',
        status: 200,
        headers: {},
      }
      const next = async () => {}

      await mw(ctx, next)
      // Should have a random UUID
      assert.ok(ctx.traceId)
      assert.equal(ctx.traceId.length, 36) // UUID length
    })
  })
})
