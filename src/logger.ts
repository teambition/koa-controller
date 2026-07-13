import type { Middleware as KoaMiddleware, Context as KoaContext, DefaultState } from 'koa'

/**
 * Minimal structured logger interface accepted by the package middleware.
 * Implementations such as Pino, Winston, or `console` can be used when they
 * provide these four methods.
 */
export interface Logger {
  /** Writes an informational log entry. */
  info(...args): void
  /** Writes a debug log entry. */
  debug(...args): void
  /** Writes a warning log entry. */
  warn(...args): void
  /** Writes an error log entry. */
  error(...args): void
}

interface Context extends KoaContext {
  skipLogger?: boolean
  routerName?: string
}

interface Middleware extends KoaMiddleware<DefaultState, Context> { }

interface Data {
  status: number
  method: string
  routerName: string
  duration: number
  url: string
  userAgent: string
  [x: string]: unknown
}

/**
 * Creates Koa middleware that records one structured informational log after
 * every request.
 *
 * The base record contains the response status, HTTP method, registered router
 * name, duration in milliseconds, original URL, and user agent. Set
 * `ctx.skipLogger = true` in downstream middleware to skip a request.
 *
 * The middleware logs from a `finally` block. Register it before the error
 * handler when the log should contain the status produced by that handler.
 * Errors thrown by `inject` are ignored and the base record is logged instead.
 *
 * @param options Logging options.
 * @param options.logger Logger that receives the record through `info`. When
 * omitted, the middleware performs no output.
 * @param options.inject Optional sync or async function used to add or replace
 * fields in the log record.
 * @returns Koa request logging middleware.
 *
 * @example
 * ```ts
 * app.use(loggerMW({
 *   logger,
 *   inject: async (data, ctx) => ({
 *     ...data,
 *     traceId: ctx.traceId,
 *     userId: ctx.state.userId,
 *   }),
 * }))
 * ```
 */
export function loggerMW({
  logger,
  inject = (d) => d,
}: {
  logger?: Logger
  inject?: (data: Data, ctx: KoaContext) => Data | Promise<Data>
} = {}): Middleware {
  return async (ctx, next) => {
    const start = Date.now()
    try {
      await next()
    } finally {
      if (!ctx.skipLogger) {
        let data = {
          status: ctx.status,
          method: ctx.method,
          routerName: ctx.routerName || 'unknown',
          duration: Date.now() - start,
          url: ctx.originalUrl,
          userAgent: ctx.get('user-agent'),
        }
        try {
          data = await inject(data, ctx)
        } catch {
          // ignore error log basic info
        }
        logger?.info(data)
      }
    }
  }
}
