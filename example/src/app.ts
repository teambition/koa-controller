import * as Koa from 'koa'
import * as c from '../../src'
import { AsyncLocalStorage } from 'async_hooks'
import { initTracer, Reporter } from 'jaeger-client'
import { Span } from 'opentracing'


// support async local storage
const als = new AsyncLocalStorage<any>()
const consoleReporter: Reporter = {
  report(span: Span): void {
    const spanAny: any = span
    console.log(`[${new Date(spanAny._startTime).toISOString()}] span: ${span.context().toTraceId()}.${span.context().toSpanId()} ${spanAny.serviceName}:${spanAny.operationName} (${spanAny._duration})`)
  },
  close(callback?: () => void): void {
    callback && callback()
  },
  setProcess(serviceName: string, tags: any): void {
  }
}
// support opentracing tracer like jaeger or zipkin
const tracer = initTracer({
  serviceName: 'koa-controller-example',
  sampler: { type: 'const', param: 1 },
}, {
  reporter: consoleReporter,
})
const app = new Koa()
app.use(c.alsMW(als))

// use tracing
app.use(c.traceMW(tracer, { als }))

// use logger
app.use(c.loggerMW({ logger: console }))

// use errorHandler
app.use(c.errorHandlerMW({ logger: { error: (error) => console.error('foo', error) } }))

// use controller
app.use(c.getRouterSync({
  files: './src/api*.ts',
}).routes())

// server start
app.listen(3000)
