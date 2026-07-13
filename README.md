# @tng/koa-controller

Decorator-based controllers and routing utilities for TypeScript applications built with [Koa](https://koajs.com/). The package includes request-state mapping, AJV validation, request logging, error handling, and OpenTracing middleware.

## Installation

```sh
pnpm add @tng/koa-controller koa koa-bodyparser
pnpm add -D typescript @types/koa @types/koa-bodyparser @types/koa-router
```

The package targets Node.js 18 or later and uses legacy TypeScript decorators. Enable decorator support in your `tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ESNext",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "experimentalDecorators": true,
    "esModuleInterop": true
  }
}
```

## Quick start

Create and export a controller. Controller methods receive `ctx.state` as their first argument and the Koa context as their second argument. Their resolved return value becomes `ctx.body`.

```ts
// src/controllers/user.ts
import { controller, get } from '@tng/koa-controller'

@controller('/api/users')
export class UserController {
  @get('/:id')
  async getUser(state, ctx) {
    return {
      id: ctx.params.id,
    }
  }
}
```

Load the exported controllers and mount the router:

```ts
// src/app.ts
import Koa from 'koa'
import bodyParser from 'koa-bodyparser'
import {
  errorHandlerMW,
  getRouterAsync,
  loggerMW,
} from '@tng/koa-controller'

const app = new Koa()

app.use(loggerMW({ logger: console }))
app.use(errorHandlerMW({ logger: console }))
app.use(bodyParser())

const router = await getRouterAsync({
  files: 'src/controllers/**/*.[jt]s',
})

app.use(router.routes())
app.use(router.allowedMethods())

app.listen(4000)
```

Use `getRouterAsync` for ESM controllers. For CommonJS projects whose controller files can be loaded with `require()`, use `getRouterSync`:

```ts
const Koa = require('koa')
const { getRouterSync } = require('@tng/koa-controller')

const app = new Koa()
const router = getRouterSync({
  files: 'src/controllers/**/*.[jt]s',
})

app.use(router.routes())
app.use(router.allowedMethods())
app.listen(4000)
```

Controllers must be exported from their modules so that the file loader can discover them.

When running TypeScript source files directly, use a TypeScript runtime/loader that supports decorators and dynamic imports. In a compiled deployment, point `files` at the emitted JavaScript instead, for example `dist/controllers/**/*.js`.

## Router

### `@controller(prefix?: string)`

Marks a class as a controller and optionally gives all of its routes a prefix. A class without decorated route methods is ignored, and a decorated method is ignored unless its class has controller metadata.

```ts
@controller('/api')
export class HealthController {
  @get('/health')
  async health() {
    return { status: 'ok' }
  }
}
```

A controller class is instantiated once when the router is built. Do not keep request-specific mutable state on the instance because it is shared by concurrent requests.

### `@request(verb?: string, pathname?: string)`

Registers a controller method for an HTTP verb and path. The same method can have more than one route decorator.

```ts
@controller('/sessions')
export class SessionController {
  @request('post', '/')
  async create(state, ctx) {
    return { created: true }
  }
}
```

Controller methods must be asynchronous/thenable. Their resolved result is assigned to `ctx.body`.

### `@get(pathname?: string)` and `@post(pathname?: string)`

Shortcuts for `@request('get', pathname)` and `@request('post', pathname)`.

## Route middleware

Middleware decorators can be applied to a controller class or an individual method:

```ts
@controller('/api')
@before(async ctx => {
  ctx.set('x-controller', 'example')
})
export class ExampleController {
  @get('/items')
  @middleware(async (ctx, next) => {
    const startedAt = Date.now()
    await next()
    ctx.set('x-duration', String(Date.now() - startedAt))
  })
  @after(async ctx => {
    ctx.set('x-handler-complete', 'true')
  })
  async list() {
    return []
  }
}
```

- `@middleware((ctx, next) => Promise<void>)` registers standard Koa middleware.
- `@before((ctx) => Promise<void>)` runs before the next middleware.
- `@after((ctx) => Promise<void>)` runs after downstream middleware completes successfully.

Within the controller and method scopes, `@before` callbacks and the entry phase of `@middleware` run from top to bottom in the order they are declared. The complete execution sequence is:

1. Controller-level `@before` callbacks and `@middleware` entry phases, in declaration order
2. Method-level `@before` callbacks and `@middleware` entry phases, in declaration order
3. Controller method
4. Method-level `@after` callbacks, from top to bottom
5. Method-level `@middleware` code after `await next()`, in reverse order
6. Controller-level `@after` callbacks, from top to bottom
7. Controller-level `@middleware` code after `await next()`, in reverse order

This follows Koa's onion model while preserving top-to-bottom decorator order within each scope.

## Loading controllers

`getRouterAsync(options)` dynamically imports every matching module and works with `ESM` controller files. `getRouterSync(options)` uses `require()` and is intended for CommonJS-loadable(`CJS`) files.

```ts
const router = await getRouterAsync({
  cwd: process.cwd(),
  files: 'src/controllers/**/*.[jt]s',
  prefix: '/v1',
})
```

Options:

| Option | Default | Description |
| --- | --- | --- |
| `cwd` | `process.cwd()` | Base directory used when resolving the glob and controller files. |
| `files` | `api/**/*.[jt]s` | Glob pattern used to discover controller modules. |
| `prefix` | `''` | Prefix passed to the underlying Koa router. |
| `logger` | `undefined` | Accepted for API compatibility; controller discovery currently uses the `koa:controller` debug namespace. |

For dependency injection or tests, use `loadRouter` to provide constructors directly:

```ts
const router = loadRouter({
  prefix: '/v1',
  controllerConstructors: [UserController],
})
```

Set `DEBUG=koa:controller` to inspect controller discovery and route registration.

## Request State

### `@state(map?)`

Without a map, `@state()` replaces `ctx.state` with a shallow merge of `ctx.query`, `ctx.request.body`, and `ctx.params`. Later sources take precedence, so path parameters override body values and body values override query values.

With a map, only the selected values are copied. Every source path is resolved from the Koa context with `lodash.get`:

```ts
@controller('/users')
export class UserController {
  @get('/:id')
  @state({
    userId: ['params.id'],
    name: ['query.name'],
    token: ['headers.authorization'],
  })
  async getUserInfo(state) {
    return state
  }
}
```

Each mapping value is an array of context paths. When multiple paths are supplied, they are evaluated from left to right and later values overwrite earlier ones.

## Validation

Validation is powered by [AJV](https://ajv.js.org/). The shared default AJV instance enables `coerceTypes` and `useDefaults`, so validation can modify the validated data.

### `@validate(schema, options?)`

Validates the complete Koa context before invoking the controller method. Invalid input throws an HTTP 400 error containing the first AJV validation message.

```ts
@validate({
  type: 'object',
  required: ['query'],
  properties: {
    query: {
      type: 'object',
      required: ['id'],
      properties: {
        id: { type: 'integer' },
      },
    },
  },
})
```

### `@validateState(schema, options?)`

Validates only `ctx.state`. Place `@state()` above `@validateState()` when the state should be built from the incoming request first:

```ts
@controller('/users')
export class UserController {
  @post('/')
  @state()
  @validateState({
    type: 'object',
    required: ['name'],
    properties: {
      name: { type: 'string', minLength: 1 },
      age: { type: 'integer', minimum: 0 },
    },
  })
  async create(state) {
    return state
  }
}
```

Both decorators accept a custom AJV instance:

```ts
@validateState(schema, { ajv })
```

### Type-safe validated state

AJV performs runtime validation; it does not automatically infer the controller method parameter type. Define the state type explicitly and use AJV's `JSONSchemaType<T>` to keep the schema consistent with that type. `JSONSchemaType<T>` requires `strictNullChecks` to be enabled in TypeScript.

```ts
import type { JSONSchemaType } from 'ajv'
import {
  controller,
  get,
  state,
  validateState,
} from '@tng/koa-controller'

interface GetUserState {
  userId: string
}

const getUserStateSchema: JSONSchemaType<GetUserState> = {
  type: 'object',
  required: ['userId'],
  properties: {
    userId: { type: 'string' },
  },
  additionalProperties: false,
}

@controller('/users')
export class UserController {
  @get('/:id')
  @state({
    userId: ['params.id'],
  })
  @validateState(getUserStateSchema)
  async getUser(state: GetUserState) {
    const { userId } = state

    return { userId }
  }
}
```

In this pattern, `@state` builds the value, `@validateState` verifies it at runtime, and `GetUserState` provides autocomplete and compile-time checks inside the controller method.

## Request logging

### `loggerMW(options?)`

Logs one structured object after every request. The object contains `status`, `method`, `routerName`, `duration`, `url`, and `userAgent`.

```ts
app.use(loggerMW({
  logger,
  inject: async (data, ctx) => ({
    ...data,
    traceId: ctx.traceId,
  }),
}))
```

Set `ctx.skipLogger = true` to suppress the request log. If `inject` throws, the middleware ignores that error and logs the base request data.

## Error handling

### `errorHandlerMW(options?)`

Catches downstream errors and responds with:

```json
{
  "error": "error message"
}
```

The middleware uses `error.status` when present and defaults to HTTP 500. Errors with status 500 or greater are sent to the optional logger.

```ts
app.use(errorHandlerMW({ logger }))
```

Register `loggerMW` before `errorHandlerMW` if the request logger should observe the final error status.

## Tracing and async context

### `traceMW(tracer, options?)`

Creates an OpenTracing span for every HTTP request, extracts an upstream span context from the request headers, and records the HTTP method, URL, and response status.

```ts
app.use(traceMW(tracer))
```

Pass `zipkinHeaderEnable: true` to fall back to Zipkin header extraction when the standard HTTP header format has no parent trace.

### `alsMW(als)`

Creates an isolated `AsyncLocalStorage` store for every request. Register it before `traceMW` to make the current span and trace ID available from the store:

```ts
import { AsyncLocalStorage } from 'node:async_hooks'
import type { Span } from 'opentracing'
import { alsMW, traceMW } from '@tng/koa-controller'

interface RequestStore {
  span?: Span
  traceId?: string
}

const als = new AsyncLocalStorage<RequestStore>()

app.use(alsMW(als))
app.use(traceMW(tracer, { als }))
```

## Development

```sh
pnpm install
pnpm lint
pnpm test
pnpm test:coverage
pnpm build
```

The build produces both ESM (`lib/*.js`) and CommonJS (`lib/*.cjs`) entry points, plus TypeScript declarations.

## License

MIT
