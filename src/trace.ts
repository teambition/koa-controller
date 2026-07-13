import type { AsyncLocalStorage } from 'async_hooks'
import { randomUUID } from 'crypto'
import type { Middleware as KoaMiddleware, Context as KoaContext, DefaultState } from 'koa'
import { Tracer, FORMAT_HTTP_HEADERS, Tags, Span } from 'opentracing'

interface Context extends KoaContext {
  tracer: Tracer
  span?: Span
  routePath?: string
  // TODO: Declare `traceId?: string` so the context type matches traceMW's runtime behavior.
}

interface Middleware extends KoaMiddleware<DefaultState, Context> { }

/**
 * Creates Koa middleware that starts a fresh AsyncLocalStorage context for
 * every request.
 *
 * The store starts as an empty object and remains available to all downstream
 * asynchronous work. Register this middleware before {@link traceMW} when the
 * request span and trace ID should be written to the store.
 *
 * @typeParam T Shape of the request-local store.
 * @param als AsyncLocalStorage instance shared by application code.
 * @returns Koa middleware that runs downstream handlers inside a request-local
 * store.
 *
 * @example
 * ```ts
 * interface RequestStore {
 *   span?: Span
 *   traceId?: string
 * }
 *
 * const als = new AsyncLocalStorage<RequestStore>()
 * app.use(alsMW(als))
 * app.use(traceMW(tracer, { als }))
 * ```
 */
// TODO: Constrain T to an object type, or accept a store factory instead of casting an empty object to T.
export function alsMW<T>(als: AsyncLocalStorage<T>): Middleware {
  return async (ctx, next) => {
    return als.run({} as T, () => {
      return next()
    })
  }
}

/**
 * Creates OpenTracing middleware for incoming HTTP requests.
 *
 * The middleware extracts a parent context from HTTP headers, creates a span,
 * and exposes it as `ctx.span`. It also exposes a trace ID as `ctx.traceId`.
 * When the request completes, the span records the HTTP method, URL, response
 * status, and an error tag for 5xx responses before it is finished.
 *
 * If an AsyncLocalStorage instance is supplied and already has an active
 * store, the span and trace ID are copied into that store. Register
 * {@link alsMW} before this middleware to create the store.
 *
 * @typeParam T Request-local store containing optional `span` and `traceId`
 * fields.
 * @param tracer OpenTracing-compatible tracer used to extract context and
 * create spans.
 * @param options Tracing options.
 * @param options.zipkinHeaderEnable When true, tries Zipkin HTTP header
 * extraction if standard OpenTracing HTTP headers contain no trace ID.
 * @param options.als Optional AsyncLocalStorage instance that receives the
 * current span and trace ID.
 * @returns Koa request tracing middleware.
 *
 * @example
 * ```ts
 * app.use(traceMW(tracer))
 * ```
 *
 * @example
 * ```ts
 * const als = new AsyncLocalStorage<RequestStore>()
 * app.use(alsMW(als))
 * app.use(traceMW(tracer, {
 *   als,
 *   zipkinHeaderEnable: true,
 * }))
 * ```
 */
export function traceMW<T extends { span?: Span, traceId?: string }>(tracer: Tracer, { zipkinHeaderEnable, als }: { zipkinHeaderEnable?: boolean, als?: AsyncLocalStorage<T> } = {}): Middleware {
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
