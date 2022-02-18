import * as Koa from 'koa'
import * as c from '../../src'
import { AsyncLocalStorage } from 'async_hooks'
import { initTracer } from 'jaeger-client'

const app = new Koa()

// support async local storage
const als = new AsyncLocalStorage<any>()
app.use((_, next) => als.run({}, next))

// support opentracing tracer like jaeger or zipkin
const tracer = initTracer({ serviceName: 'koa-controller-example' }, {})
app.use(c.traceMW(tracer, { als }))

// support logger
app.use(c.loggerMW({ logger: { info: (message) => console.log( JSON.stringify(message) ) } }))

// support errorHandler
app.use(c.errorHandlerMW({ logger: { error: (error) => console.error('foo', error) } }))

// support controller by using typescript decorator
app.use(c.getRouterSync({
  files: './src/api/**/*.ts',
}).routes())

// server start
app.listen(3000)
