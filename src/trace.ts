import { AsyncLocalStorage } from 'async_hooks'
import { randomUUID } from 'crypto'
import type { Middleware as KoaMiddleware, Context as KoaContext, DefaultState } from 'koa'
import { Tracer, FORMAT_HTTP_HEADERS, Tags, Span } from 'opentracing'

interface Context extends KoaContext {
  tracer: Tracer
  span?: Span
  routePath?: string
}

interface Middleware extends KoaMiddleware<DefaultState, Context> { }

export function alsMW<T = any>(als: AsyncLocalStorage<T>): Middleware {
  return async (ctx, next) => {
    return als.run({} as any, () => {
      return next()
    })
  }
}

export function traceMW(tracer: Tracer, { zipkinHeaderEnable, als }: { zipkinHeaderEnable?: boolean, als?: AsyncLocalStorage<any> } = {}): Middleware {
  return async function traceMW (ctx, next) {
    let parentSpanContext = tracer.extract(FORMAT_HTTP_HEADERS, ctx.headers)
    if (!parentSpanContext?.toTraceId() && zipkinHeaderEnable) {
      parentSpanContext = tracer.extract('ZIPKIN_HTTP_HEADERS', ctx.headers)
    }

    const span = ctx.span = tracer.startSpan('http-request', {
      childOf: parentSpanContext,
    })
    const traceId = ctx.traceId = span?.context().toTraceId() || randomUUID()

    if (als?.getStore()) {
      als.getStore().span = span
      als.getStore().traceId = traceId
    } 

    return next().finally(() => {
      span.setOperationName(`http-request ${ctx.method} ${ctx.routePath || ctx.url || 'unknown'}`)
      span.setTag(Tags.HTTP_STATUS_CODE, ctx.status)
      span.setTag(Tags.HTTP_METHOD, ctx.method)
      span.setTag(Tags.HTTP_URL, ctx.url)
      if (ctx.status >= 500) {
        span.setTag(Tags.ERROR, true)
      }
      span?.finish()
    })
  }
}
