# @tng/koa-controller

Decorator-based controllers and routing utilities for TypeScript applications built with [Koa](https://koajs.com/). The package includes typed request-state mapping, OpenAPI generation, AJV validation, request logging, error handling, and OpenTracing middleware.

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

### `@stateInput(fields)`

Builds `ctx.state` from the fields you declare and gives you its type. Each field says which part of the request it comes from and keeps the name it has there.

```ts
import { controller, post, stateInput, validateState, Type, type InputType } from '@tng/koa-controller'

const CreateComment = {
  id: Type.Number({ from: 'params', required: true }),
  content: Type.String({ required: true }),
  page: Type.Number({ from: 'query' }),
  tags: Type.Array(Type.String()),
}

@controller('/posts')
export class CommentController {
  @post('/:id/comments')
  @stateInput(CreateComment)
  @validateState({
    type: 'object',
    required: ['id', 'content'],
    properties: {
      id: { type: 'integer' },
      content: { type: 'string', minLength: 1 },
      page: { type: 'integer', minimum: 1 },
      tags: { type: 'array', items: { type: 'string' } },
    },
  })
  async create(state: InputType<typeof CreateComment>) {
    // state: { id: number; content: string; page?: number; tags?: string[] }
    return state
  }
}
```

`POST /posts/42/comments?page=2` with body `{ "content": "hi" }` gives `{ id: 42, content: 'hi', page: 2 }`.

The two decorators have separate jobs:

| Decorator | Job |
| --- | --- |
| `@stateInput` | Picks each field from its source and puts it in `ctx.state`. Describes the state's TypeScript type. |
| [`@validateState`](#validatestateschema-options) | Checks the state with AJV: types, required fields, any other JSON Schema rule. Converts values such as `"42"` to `42`. |

`@stateInput` on its own does not validate or convert anything. Values are copied as they arrive, so without `@validateState` the `id` above is the string `"42"` and a missing `content` is simply absent. The types you declare with `Type` are a description of what the method expects; the `@validateState` schema is what enforces it. Keep the two in agreement: nothing checks that they match.

Field options:

| Option | Default | Description |
| --- | --- | --- |
| `from` | `'body'` | Where the field is read from: `'params'`, `'query'`, or `'body'`. |
| `required` | `false` | Set to `true` to make the field a non-optional property of the state type. |

Builders:

| Builder | State type |
| --- | --- |
| `Type.String()` | `string` |
| `Type.Number()` | `number` |
| `Type.Boolean()` | `boolean` |
| `Type.Array(Type.String())` | `string[]` |
| `Type.Enum(['asc', 'desc'])` | `'asc' \| 'desc'` |
| `Type.Object({ name: Type.String({ required: true }) })` | `{ name: string }` |
| `Type.Union([Type.String(), Type.Number()])` | `string \| number` |

How the state is built:

- **Only declared fields are copied.** A field is read from its own source and nowhere else, so a body field cannot be supplied through the query string, and undeclared fields never reach `state`.
- **Names are not changed.** `id` with `from: 'params'` is `ctx.params.id`.
- **The result replaces `ctx.state`.** Copy anything you need from earlier middleware onto `ctx` instead.
- **`from` is for top-level fields.** A nested object or array is read as a whole from one source. Request headers are not a source; read them from `ctx`.
- **There are no default values.** Handle them in the method, for example `state.page ?? 1`.

The decorator checks the method against the definition at compile time: declaring `state: { id: string }` for the definition above is a type error.

### `@state(map?)` (deprecated)

> Deprecated. Use [`@stateInput`](#stateinputfields), which also validates the state and provides its type.

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

## OpenAPI

### `generateOpenAPI(options)`

Generates an [OpenAPI 3.1](https://spec.openapis.org/oas/v3.1.0) document from a router built by `getRouterAsync`, `getRouterSync` or `loadRouter`. Paths and methods are the ones the router actually serves, prefix included, and parameters and request bodies come from [`@stateInput`](#stateinputfields):

| `@stateInput` field | In the document |
| --- | --- |
| `from: 'params'` | Path parameter |
| `from: 'query'` | Query parameter |
| `from: 'body'` (the default) | Property of the JSON request body |

```ts
import { generateOpenAPI, getRouterAsync } from '@tng/koa-controller'

const router = await getRouterAsync({
  files: 'src/controllers/**/*.[jt]s',
  prefix: '/v1',
})
app.use(router.routes())

const document = generateOpenAPI({
  router,
  info: { title: 'Blog API', version: '1.0.0' },
})
```

The result is a plain object. Serve it from a route, or write it to a file.

Options:

| Option | Description |
| --- | --- |
| `router` | The router to document. Required. |
| `info` | `{ title, version }`, plus any other OpenAPI `info` fields. Required. |
| `prefix` | Prefix added to every path, for a router mounted under a path it does not know about, such as with `koa-mount`. |
| `servers` | OpenAPI server objects. |
| `components` | OpenAPI components, copied unchanged. Use it for security schemes. |
| `security` | Security requirements applied to every operation. |

Which routes are documented:

- **Routes built from controllers.** Each route handler `loadRouter` registers carries its controller method's metadata, so the document follows the router: a prefix set later with `router.prefix()` is included, and so is the path of a parent router the routes are merged into with `parent.use('/api', router.routes())`. Such a parent router can be passed too.
- **Not routes added by hand**, such as `router.get('/health', ...)`.
- **Optional segments** such as `/list{/:page}` become one path per variant, since OpenAPI paths cannot have optional parts. Wildcards such as `/*rest` become a `{rest}` parameter.
- A router that was not built by koa-controller and has none of its routes is rejected with a `TypeError`.

What ends up in the document:

- **Types and required flags** from the `Type` builders.
- **Rules from a [`@validateState`](#validatestateschema-options) on the same method**: its top-level `properties` are merged into the matching fields and its `required` list is honored, so `{ type: 'integer', minimum: 1 }` shows up on the parameter. Where the two disagree, the `@validateState` rule is shown, since that is what requests are checked against.
- **Path parameters without a `@stateInput` field** are listed as strings.
- **A `400` response** on every route that uses `@validateState`.

What does not: anything in a `@validateState` schema beyond its top-level `properties` and `required` (a root `oneOf`, `anyOf` or `if`, for example), request headers, and routes whose state is built with the deprecated `@state`, which does not say where a field comes from. Response bodies are only documented when you describe them with `@apiDoc`.

### `@apiDoc(options)`

Adds descriptions and responses to an operation. It has no effect on request handling.

```ts
@controller('/posts')
@apiDoc({ tags: ['posts'], responses: { 401: { description: 'Not signed in' } } })
export class PostController {
  @get('/:id')
  @apiDoc({
    summary: 'Get a post',
    responses: {
      200: { description: 'The post' },
      404: { description: 'No post has this id' },
    },
  })
  @stateInput({ id: Type.Number({ from: 'params', required: true }) })
  async show(state: { id: number }) {
    return postService.find(state.id)
  }
}
```

| Option | Default | Description |
| --- | --- | --- |
| `summary`, `description` | none | Text for the operation. Method only. |
| `operationId` | `ControllerName_methodName` | Unique name of the operation. Method only. |
| `tags` | The controller class name | Groups operations. |
| `deprecated` | none | Marks the operation as deprecated. |
| `responses` | `200: Successful response` | OpenAPI response objects keyed by status code, copied unchanged. |

On a class, `tags`, `deprecated` and `responses` are defaults for every route; values on a method override them.

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
