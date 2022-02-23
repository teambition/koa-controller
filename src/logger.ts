import type { Middleware as KoaMiddleware, Context as KoaContext, DefaultState } from 'koa'

interface Logger {
  info(...args): void
  // debug(...args): void
  // warn(...args): void
  // error(...args): void
}

interface Context extends KoaContext {
  skipLogger?: boolean
  routerName?: string
}

interface Middleware extends KoaMiddleware<DefaultState, Context> { }

export function loggerMW({ logger }: { logger?: Logger } = {}): Middleware {
  return async (ctx, next) => {
    const start = Date.now()
    try {
      await next()
    } finally {
      if (!ctx.skipLogger) {
        if (logger) logger.info({
          status: ctx.status,
          method: ctx.method,
          routerName: ctx.routerName || 'unknown',
          duration: Date.now() - start,
          url: ctx.originalUrl,
          userAgent: ctx.get('user-agent'),
        })
      }
    }
  }
}
