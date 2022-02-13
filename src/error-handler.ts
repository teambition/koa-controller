import type { Middleware } from 'koa'

export function errorHandlerMW({
  logger,
}: {
  logger?: any
} = {}): Middleware {
  return async (ctx, next) => {
    try {
      await next()
    } catch (e) {
      const status = ctx.status = e.status || 500
      ctx.body = {
        error: e.message
      }
      if (status >= 500) {
        if (logger) logger.error(Object.assign(e, {
          method: ctx.method,
          url: ctx.url,
          headers: ctx.headers,
          reqBody: JSON.stringify(ctx.request.body),
        }))
      }
    }
  }
}