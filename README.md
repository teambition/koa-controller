# @tng/koa-controller

Decorator-based controllers and routing utilities for TypeScript applications built with [Koa](https://koajs.com/). The package includes request-state mapping, AJV validation, request logging, error handling, and OpenTracing middleware.

## Installation

```sh
pnpm add @tng/koa-controller koa koa-bodyparser
pnpm add -D typescript @types/koa @types/koa-bodyparser @types/koa-router
```

`koa` is a peer dependency (version 2 or later). The package targets Node.js 20 or later and uses legacy TypeScript decorators. Enable decorator support in your `tsconfig.json`:

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

### Controller inheritance

A controller can extend another controller. The subclass inherits the parent's routes and middlewares; decorating the subclass never changes the parent.

```ts
@controller('/v1/users')
@before(authenticate)
export class UserController {
  @get('/:id')
  async getUser(state, ctx) {
    return this.find(ctx.params.id)
  }
}

@controller('/v2/users')
export class UserV2Controller extends UserController {
  @get('/:id/profile')
  async getProfile(state, ctx) {
    return this.findProfile(ctx.params.id)
  }
}
```

- Prefixes are not inherited. A subclass is registered only under the prefixes it declares with its own `@controller`, and a subclass without `@controller` is not registered.
- Parent middlewares wrap the subclass's own: parent `@before` callbacks run first and parent `@after` callbacks run last.
- Each registered class gets its own instance, so an inherited route calls the subclass's overridden methods.

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

A method may also write the response itself, for example by assigning a stream to `ctx.body` or calling `ctx.redirect()`. When the method resolves to `undefined`, a body it set on the context is kept. When it neither returns a value nor sets a body, the response is `204 No Content`.

```ts
@get('/download')
async download(state, ctx) {
  ctx.type = 'text/csv'
  ctx.body = createReadStream(reportPath)
}
```

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

Matched files are loaded in ascending order of their paths, on every platform. Routes are matched in the order they are registered, so when two routes overlap, the one in the file that sorts first wins. Name the files to control this:

```text
controllers/01-users-me.ts    →  GET /users/me     (registered first)
controllers/02-users.ts       →  GET /users/:id
```

Paths are compared character by character, so digits sort before uppercase letters, which sort before lowercase letters, and `10-x.ts` sorts before `2-x.ts`. Pad numeric prefixes with zeros (`02-`, `10-`).

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

Sensitive query parameters in `url` are redacted (see [Redaction](#redaction)); pass `redactQuery: ['name']` to add more.

Set `ctx.skipLogger = true` to suppress the request log. If `inject` throws, the middleware ignores that error and logs the base request data.

## Error handling

### `errorHandlerMW(options?)`

Catches downstream errors and responds with:

```json
{
  "error": "error message"
}
```

The middleware uses `error.status` when present and defaults to HTTP 500.

```ts
app.use(errorHandlerMW({ logger }))
```

Register `loggerMW` before `errorHandlerMW` if the request logger should observe the final error status.

**Response message.** The error's own message is sent to the client only when it is safe to expose:

| Error | Message sent |
| --- | --- |
| Status below 500 (for example `ctx.throw(400, 'name is required')`) | The error message |
| Status 500 or above, or no status | The status text, for example `Internal Server Error` |
| `error.expose` set to `true` or `false` | Follows `expose`, whatever the status |

This matches the `expose` convention of [`http-errors`](https://github.com/jshttp/http-errors) and keeps internal details such as database errors out of responses.

**Logging.** Errors with status 500 or greater are sent to the optional logger as the error object with `method`, `url`, and `headers` attached. Sensitive values are replaced by `[REDACTED]` (see [Redaction](#redaction)), and the request body is not logged by default.

| Option | Default | Description |
| --- | --- | --- |
| `logger` | `undefined` | Object with an `error` method. |
| `redactHeaders` | `[]` | Header names to redact in addition to the defaults. |
| `redactQuery` | `[]` | Query parameter names to redact in addition to the defaults. |
| `logBody` | `false` | Adds the serialized request body as `reqBody`. The body is logged as is, without redaction. |
| `serialize` | `undefined` | `(error, ctx) => unknown`. Builds the value passed to `logger.error`, replacing the default entry. |

Use `serialize` for full control, for example to log a body with your own field-level redaction:

```ts
app.use(errorHandlerMW({
  logger,
  serialize: (error, ctx) => ({
    err: error,
    method: ctx.method,
    url: redactUrl(ctx.url),
    body: omit(ctx.request.body, ['password']),
  }),
}))
```

## Redaction

Request logs, error logs, and trace spans replace sensitive values with `[REDACTED]`. Names are matched case-insensitively.

| Where | Redacted by default |
| --- | --- |
| Headers (`errorHandlerMW`) | `authorization`, `proxy-authorization`, `cookie`, `set-cookie`, `x-api-key`, `x-auth-token`, `x-csrf-token`, `x-xsrf-token` |
| URL query parameters (`loggerMW`, `errorHandlerMW`, `traceMW`) | `token`, `access_token`, `refresh_token`, `id_token`, `password`, `passwd`, `secret`, `client_secret`, `api_key`, `apikey`, `signature`, `sig` |

Add your own names with the `redactHeaders` and `redactQuery` options. Redaction is by name only: a secret in the URL path, or in a header or parameter that is not listed, is not detected.

The helpers are exported for use in `serialize` and `inject` callbacks:

```ts
import { redactHeaders, redactUrl } from '@tng/koa-controller'

redactUrl('/callback?token=abc&page=2') // '/callback?token=[REDACTED]&page=2'
redactHeaders(ctx.headers, ['x-internal-secret'])
```

## Tracing and async context

### `traceMW(tracer, options?)`

Creates an OpenTracing span for every HTTP request, extracts an upstream span context from the request headers, and records the HTTP method, URL, and response status.

```ts
app.use(traceMW(tracer))
```

Pass `zipkinHeaderEnable: true` to fall back to Zipkin header extraction when the standard HTTP header format has no parent trace.

The span is named after the matched route, for example `http-request GET /users/:id`. The recorded URL has sensitive query parameters redacted (see [Redaction](#redaction)); pass `redactQuery: ['name']` to add more.

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

The build produces both ESM (`lib/*.js`) and CommonJS (`lib/*.cjs`) entry points, each with its own TypeScript declarations (`lib/*.d.ts` and `lib/*.d.cts`).

## License

MIT
