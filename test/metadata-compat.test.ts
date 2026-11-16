import 'mocha'
import { strict as assert } from 'assert'
import { loadRouter } from '../src/router.js'
import { stateInput, Type } from '../src/state-input.js'
import { validateState } from '../src/validate.js'
import { apiDoc, generateOpenAPI } from '../src/openapi.js'

/**
 * Writes controller metadata the way version 2.0.1 does: method metadata has
 * only `routes` and `middlewares`. Another installed copy of the package at
 * that version would leave exactly this under the shared global symbol.
 */
function decorateLikeV201(constructor: Function, prefix: string, routes: Record<string, [string, string]>) {
  const methodMetaMap = new Map<string, { routes: { verb: string, pathname: string }[], middlewares: unknown[] }>()
  for (const [propertyName, [verb, pathname]] of Object.entries(routes)) {
    methodMetaMap.set(propertyName, { routes: [{ verb, pathname }], middlewares: [] })
  }
  Object.defineProperty(constructor, Symbol.for('@tng/koa-controller:controller'), {
    value: { prefixs: [prefix], middlewares: [], methodMetaMap },
    configurable: true,
    writable: true,
  })
}

async function call(router: ReturnType<typeof loadRouter>, method: string, path: string) {
  const ctx: any = { method, path, headers: {}, query: {}, request: { body: {} } }
  await router.routes()(ctx, (() => {}) as any)
  return ctx
}

describe('metadata written by an older copy of the package', () => {
  const info = { title: 'Test API', version: '1.0.0' }

  it('should register and document a controller decorated by version 2.0.1', async () => {
    class LegacyController {
      async hello() { return 'hello' }
    }
    decorateLikeV201(LegacyController, '/legacy', { hello: ['get', '/hello'] })

    const router = loadRouter({ controllerConstructors: [LegacyController as any] })
    assert.equal((await call(router, 'GET', '/legacy/hello')).body, 'hello')

    const { paths } = generateOpenAPI({ router, info })
    assert.deepEqual(paths['/legacy/hello'].get, {
      operationId: 'LegacyController_hello',
      tags: ['LegacyController'],
      responses: { 200: { description: 'Successful response' } },
    })
  })

  it('should let this version add metadata to a method decorated by version 2.0.1', async () => {
    class MixedController {
      async show(state: unknown) { return state }
    }
    decorateLikeV201(MixedController, '/mixed', { show: ['get', '/:id'] })
    const descriptor = Object.getOwnPropertyDescriptor(MixedController.prototype, 'show')!
    validateState({ type: 'object', properties: { id: { type: 'integer' } } })(MixedController.prototype, 'show', descriptor)
    stateInput({ id: Type.Number({ from: 'params' }) })(MixedController.prototype, 'show', descriptor as any)
    apiDoc({ summary: 'Show one' })(MixedController.prototype, 'show', descriptor)

    const router = loadRouter({ controllerConstructors: [MixedController as any] })
    assert.deepEqual((await call(router, 'GET', '/mixed/7')).body, { id: 7 })

    const { paths } = generateOpenAPI({ router, info })
    assert.equal(paths['/mixed/{id}'].get.summary, 'Show one')
    assert.deepEqual(paths['/mixed/{id}'].get.parameters, [
      { name: 'id', in: 'path', required: true, schema: { type: 'integer' } },
    ])
  })
})
