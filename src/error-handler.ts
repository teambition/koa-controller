import type { Middleware } from 'koa'

/**
 * Creates Koa middleware that converts downstream exceptions into JSON error
 * responses.
 *
 * The response status is read from `error.status` and defaults to 500. The
 * response body is `{ error: error.message }`. Errors with status 500 or above
 * are passed to the optional logger together with the request method, URL,
 * headers, and serialized request body.
 *
 * Register this middleware before middleware whose errors it should catch.
 * When using `loggerMW`, register the request logger first so it observes the
 * final response status set by this handler.
 *
 * @param options Error handling options.
 * @param options.logger Optional logger with an `error` method. Only server
 * errors with status 500 or above are logged.
 * @returns Koa error handling middleware.
 *
 * @example
 * ```ts
 * app.use(loggerMW({ logger }))
 * app.use(errorHandlerMW({ logger }))
 * app.use(router.routes())
 * ```
 */
export function errorHandlerMW({
  logger,
}: {
  logger?: { error: (...args: unknown[]) => void }
} = {}): Middleware {
  return async (ctx, next) => {
    try {
      await next()
    } catch (e) {
      const error = normalizeError(e)
      const status = ctx.status = typeof error.status === 'number' ? error.status : 500
      ctx.body = {
        error: error.message
      }
      if (status >= 500) {
        if (logger) logger.error(Object.assign(error, {
          method: ctx.method,
          url: ctx.url,
          headers: ctx.headers,
          reqBody: JSON.stringify(ctx.request.body),
        }))
      }
    }
  }
}

type ErrorWithStatus = Error & { status?: number }

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
