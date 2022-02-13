@tng/koa-controller (WIP)
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

## Router (WIP)
## Logger (WIP)
## Tracer (WIP)
## Validator (WIP)
## State (WIP)
## Error Handler (WIP)

## Contribution (WIP)
