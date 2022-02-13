import { Middleware } from 'koa'

export function loggerMW({ logger }: { logger?: any } = {}): Middleware {
  return async (ctx, next) => {
    const start = Date.now()
    try {
      await next()
    } finally {
      if (!ctx.skipLogger) {
        if (logger) logger.info({
          status: ctx.status,
          method: ctx.method,
          duration: Date.now() - start,
          url: ctx.originalUrl,
          userAgent: ctx.get('user-agent'),
        })
      }
    }
  }
}
