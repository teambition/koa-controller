@tng/koa-controller
====

Write koa http server with koa-controller by decorator feature in typescript. Make job easily done in a short time.

## Usage Example

```typescript
// path/to/controller.ts
import { controller, get } from '@tng/koa-controller'

@controller('/api')
class UserController {
  @get('/login')
  async login() {
    return 'OK'
  }
}

// path/to/main/koa/server.ts
import { getRouterSync } from '@tng/koa-controller'
const app = new Koa()

// inject all related controller files by given glob pattern
app.use(getRouterSync({
  files: path.resolve('path/to/controller/**/*.[jt]s'),
}).routes())

```

## Router

### @controller(prefix?: string)
Register a route on a class for router as a controller.

`NOTE` The router will ignore the route if no route method is provided in the class.
And for the contrast, the route method will be ignored unless the controller is registed.

### @request(verb: string, route: string)
Register a route on a method for router.
It will run other middleware as well when route is matched.
The sequence is in [middleware squence](#middleware-sequence) section.

Method's first parameter is the state of context, or `ctx.state`; second paramenter is the koa context or `ctx` for the request.
Method should be a thenable async function which return the result for response body.

`NOTE` A method can be registered for multi routes. all the result and the middlewares will be shared.

example:
```ts
class SomeController {
  @request('get', '/login')
  async somePath(state, ctx: Context) {
    // state is for context.state
    // ctx is for context
    return result // equivalent to ctx.body = result
  }
}
```

### `@before((ctx: KoaContext) => Promise<void>)`
### `@after((ctx: KoaContext) => Promise<void>)`
### `@middleware((ctx: KoaContext, next: Promise<void>) => Promise<void>)`
Register a before middleware, a after middleware or a middleware for a route which register either on method or controller class.

### middleware sequence
if same decorator written 2 or more times, router will run in sequence from top to bottom.
Please see `test/router.test.ts` file to learn more about it.

- controller @middleware | @before
- method @middleware | @before
- method function
- method @after
- controller @after

### `@get(pathname: string)`
### `@post(pathname)`
The shortcut for `@request('get', pathname)` and `@request('post', pathname)`

### getRouterSync(options): KoaRouter
Run `require` to require files and return koa router instance.

- options: `<Object>`
  - files: `<String>` glob pattern to run Nodejs's `require` function. glob will base on `cwd` option.
  - cwd: `<String>` base working directory to run `require` function. Default is `process.cwd()`.
  - prefix: `<String>` Koa Router contructor's parameter to generate Koa Router.
  - logger: `<Logger>` Logger has `debug` or `info` method to debug file or functions.

## Logger (TODO)

## Tracer
Use `opentracing` implemented tracer instance to cross-platform tracing.

### traceMW(tracer: Tracer, options?): KoaMiddleware
WIP: Use `opentracing` implemented tracer instance to cross-platform tracing.

## Validate
### @validate(schema: JSONSchema, { ajv: AjvInstance })
Generate a `@before` middleware to register on a method or controller by using `AJV`.

Example
```ts
@validate({
  type: 'object',
  require: ['query'],
  properties: {
    query: {
      type: 'object',
      require: ['id'],
      properties: {
        id: { type: 'integer' },
      }
    }
  }
})
class SomeController { ... }
```

### @validateState(schema: JSONSchema, { ajv: AjvInstance })
Generate a `@before` middleware to register on a method or controller by using `AJV` but ONLY validate `ctx.state`.
It should be always be used with `@state()`

## state
### @state(map: {[key: string]: PathFromContext/String })
Generate ctx.state from `ctx.query`, `ctx.params` and `ctx.request.body` if map is undefined.
If map is provided only mapped key-value pair will be included into state.

The key in map will be the key in state.
The value in map will be resolved the value in state by finding the value of context in a certain path.
Value path maybe provided in a array. It means the order to find a value from context.

example
```ts
class UserController {
  @get('/users/:id')
  @state({
    userId: ['params.id'],
    age: ['query.name'],
    token: ['header.authorization'],
  })
  async getUserInfo(state) {
    // GET /users/123?name=John&age=18
    state = {
      userId, // 123 (string)
      name, // John
      // age will not be in the state
      token, // token is undefined unless it passed.
    }
  }
}
```

## Error Handler (TODO)

## Contribution (WIP)
