import { STATUS_CODES } from 'http'
import type { Context, Middleware } from 'koa'
import { redactHeaders, redactUrl } from './redact.js'

/**
 * Creates Koa middleware that converts downstream exceptions into JSON error
 * responses.
 *
 * The response status is read from `error.status` and defaults to 500. The
 * response body is `{ error: message }`. The error's own message is only sent
 * to the client when the error is marked `expose: true`, or has no `expose`
 * flag and a status below 500. Otherwise the standard status text is sent, for
 * example `Internal Server Error`, so internal details are not leaked.
 *
 * Errors with status 500 or above are passed to the optional logger together
 * with the request method, URL, and headers. Sensitive headers and query
 * parameters are replaced by `[REDACTED]`. The request body is not logged
 * unless `logBody` is enabled.
 *
 * Register this middleware before middleware whose errors it should catch.
 * When using `loggerMW`, register the request logger first so it observes the
 * final response status set by this handler.
 *
 * @param options Error handling options.
 * @param options.logger Optional logger with an `error` method. Only server
 * errors with status 500 or above are logged.
 * @param options.redactHeaders Header names to redact in addition to
 * `defaultRedactedHeaders`.
 * @param options.redactQuery Query parameter names to redact in addition to
 * `defaultRedactedQueryKeys`.
 * @param options.logBody When true, adds the serialized request body to the
 * log entry as `reqBody`. The body is logged as is; it is not redacted.
 * @param options.serialize Builds the value passed to `logger.error`,
 * replacing the default log entry. If it throws, the default entry is logged.
 * @returns Koa error handling middleware.
 *
 * @example
 * ```ts
 * app.use(loggerMW({ logger }))
 * app.use(errorHandlerMW({ logger }))
 * app.use(router.routes())
 * ```
 *
 * @example
 * ```ts
 * app.use(errorHandlerMW({
 *   logger,
 *   redactHeaders: ['x-internal-secret'],
 *   serialize: (error, ctx) => ({
 *     err: error,
 *     method: ctx.method,
 *     path: ctx.path,
 *   }),
 * }))
 * ```
 */
export function errorHandlerMW({
  logger,
  redactHeaders: extraHeaders,
  redactQuery,
  logBody = false,
  serialize,
}: {
  logger?: { error: (...args: unknown[]) => void }
  redactHeaders?: string[]
  redactQuery?: string[]
  logBody?: boolean
  serialize?: (error: Error, ctx: Context) => unknown
} = {}): Middleware {
  return async (ctx, next) => {
    try {
      await next()
    } catch (e) {
      const error = normalizeError(e)
      const status = ctx.status = typeof error.status === 'number' ? error.status : 500
      const expose = typeof error.expose === 'boolean' ? error.expose : status < 500
      ctx.body = {
        error: expose ? error.message : (STATUS_CODES[status] ?? 'Internal Server Error')
      }
      if (status >= 500 && logger) {
        let entry: unknown
        let serialized = false
        if (serialize) {
          try {
            entry = serialize(error, ctx)
            serialized = true
          } catch {
            // fall back to the default log entry
          }
        }
        if (!serialized) {
          entry = Object.assign(error, {
            method: ctx.method,
            url: redactUrl(ctx.url, redactQuery),
            headers: redactHeaders(ctx.headers, extraHeaders),
          }, logBody ? { reqBody: JSON.stringify(ctx.request.body) } : {})
        }
        logger.error(entry)
      }
    }
  }
}

type ErrorWithStatus = Error & { status?: number, expose?: boolean }

function normalizeError(value: unknown): ErrorWithStatus {
  if (value instanceof Error) return value

  const error = new Error(
    typeof value === 'object' && value !== null && 'message' in value
      ? String(value.message)
      : String(value)
  ) as ErrorWithStatus

  if (typeof value === 'object' && value !== null) {
    Object.assign(error, value)
  }
  return error
}
