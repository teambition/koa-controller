import type { Middleware as KoaMiddleware, Context as KoaContext, DefaultState } from 'koa'

export interface Logger {
  info(...args): void
  debug(...args): void
  warn(...args): void
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
  [x: string]: any
}

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
