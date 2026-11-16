import 'mocha'
import { strict as assert } from 'assert'
import { mkdtempSync, writeFileSync, rmSync } from 'fs'
import { join } from 'path'
import KoaRouter from 'koa-router'
import { controller, get, post, request, getRouterAsync, getRouterSync, loadRouter } from '../src/router.js'
import { stateInput, Type } from '../src/state-input.js'
import type { InputType } from '../src/state-input.js'
import { validateState } from '../src/validate.js'
import { state } from '../src/state.js'
import { apiDoc, generateOpenAPI } from '../src/openapi.js'

describe('openapi test suite', () => {
  const info = { title: 'Test API', version: '1.2.3' }
  const routerOf = (...controllerConstructors: any[]) => loadRouter({ controllerConstructors })

  const CommentFields = {
    id: Type.Number({ from: 'params', required: true }),
    content: Type.String({ required: true }),
    page: Type.Number({ from: 'query' }),
    sort: Type.Enum(['asc', 'desc'], { from: 'query', required: true }),
    tags: Type.Array(Type.String()),
    author: Type.Union([Type.String(), Type.Number()]),
  }

  @controller('/posts')
  class PostController {
    @post('/:id/comments')
    @apiDoc({ summary: 'Add a comment', description: 'Adds a comment to a post.', tags: ['comments'] })
    @stateInput(CommentFields)
    @validateState({
      type: 'object',
      required: ['page'],
      properties: {
        id: { type: 'integer', minimum: 1 },
        page: { type: 'integer' },
        content: { type: 'string', minLength: 1 },
      },
    })
    async createComment(state: InputType<typeof CommentFields>) { return state }

    @get('/')
    async list() { return [] }

    @get('/:id')
    async show() { return {} }
  }

  it('should describe a route with path, query and body fields', () => {
    const document = generateOpenAPI({ router: routerOf(PostController), info })
    assert.equal(document.openapi, '3.1.0')
    assert.deepEqual(document.info, info)
    assert.deepEqual(Object.keys(document.paths), ['/posts/{id}/comments', '/posts', '/posts/{id}'])
    assert.deepEqual(document.paths['/posts/{id}/comments'], {
      post: {
        operationId: 'PostController_createComment',
        tags: ['comments'],
        summary: 'Add a comment',
        description: 'Adds a comment to a post.',
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'integer', minimum: 1 } },
          { name: 'page', in: 'query', required: true, schema: { type: 'integer' } },
          { name: 'sort', in: 'query', required: true, schema: { type: 'string', enum: ['asc', 'desc'] } },
        ],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  content: { type: 'string', minLength: 1 },
                  tags: { type: 'array', items: { type: 'string' } },
                  author: { type: ['string', 'number'] },
                },
                required: ['content'],
              },
            },
          },
        },
        responses: {
          200: { description: 'Successful response' },
          400: { description: 'Invalid request' },
        },
      },
    })
  })

  it('should describe routes without stateInput from the path alone', () => {
    const document = generateOpenAPI({ router: routerOf(PostController), info })
    assert.deepEqual(document.paths['/posts'], {
      get: {
        operationId: 'PostController_list',
        tags: ['PostController'],
        responses: { 200: { description: 'Successful response' } },
      },
    })
    assert.deepEqual(document.paths['/posts/{id}'].get.parameters, [
      { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
    ])
  })

  it('should not change how requests are handled', async () => {
    const router = loadRouter({ controllerConstructors: [PostController] })
    const ctx: any = {
      method: 'POST', path: '/posts/5/comments', headers: {}, query: { page: '2', sort: 'asc' }, request: { body: { content: 'hi' } },
    }
    await router.routes()(ctx, (() => {}) as any)
    assert.deepEqual(ctx.body, { id: 5, content: 'hi', page: 2, sort: 'asc' })
  })

  it('should document the paths the router registers, including its prefix', () => {
    const router = loadRouter({ controllerConstructors: [PostController], prefix: '/v1' })
    const document = generateOpenAPI({ router, info })
    assert.deepEqual(Object.keys(document.paths), ['/v1/posts/{id}/comments', '/v1/posts', '/v1/posts/{id}'])
  })

  it('should add the prefix option for a router mounted under an outer path', () => {
    const router = loadRouter({ controllerConstructors: [PostController], prefix: '/v1' })
    const servers = [{ url: 'https://api.example.com' }]
    const document = generateOpenAPI({ router, info, prefix: '/api', servers })
    assert.deepEqual(Object.keys(document.paths), ['/api/v1/posts/{id}/comments', '/api/v1/posts', '/api/v1/posts/{id}'])
    assert.deepEqual(document.servers, servers)
  })

  it('should document a router built by getRouterSync or getRouterAsync', async () => {
    const tmpDir = mkdtempSync(join(process.cwd(), '.test-tmp-'))
    try {
      writeFileSync(join(tmpDir, 'file.ts'), `
import { controller, get, stateInput, Type } from '../src/index.js'

@controller('/files')
export class FileController {
  @get('/:name')
  @stateInput({ name: Type.String({ from: 'params', required: true }) })
  async show(state: { name: string }) { return state }
}
`)
      writeFileSync(join(tmpDir, 'file.cjs'), `
class CjsController { async list() { return [] } }
exports.CjsController = CjsController
`)
      const asyncRouter = await getRouterAsync({ cwd: tmpDir, files: '**/*.ts', prefix: '/v1' })
      assert.deepEqual(Object.keys(generateOpenAPI({ router: asyncRouter, info }).paths), ['/v1/files/{name}'])

      // Undecorated classes register nothing, but the router is still recognized.
      const syncRouter = getRouterSync({ cwd: tmpDir, files: '**/*.cjs' })
      assert.deepEqual(generateOpenAPI({ router: syncRouter, info }).paths, {})
    } finally {
      rmSync(tmpDir, { recursive: true, force: true })
    }
  })

  it('should document routes merged into another router', () => {
    const router = loadRouter({ controllerConstructors: [PostController], prefix: '/v1' })
    const parent = new KoaRouter()
    parent.use('/api', router.routes())
    const document = generateOpenAPI({ router: parent, info })
    assert.deepEqual(Object.keys(document.paths), ['/api/v1/posts/{id}/comments', '/api/v1/posts', '/api/v1/posts/{id}'])
    assert.equal(document.paths['/api/v1/posts'].get.operationId, 'PostController_list')
  })

  it('should leave out routes added to the router by hand', () => {
    const router = routerOf(PostController)
    router.get('/health', async ctx => { ctx.body = 'ok' })
    assert.ok(!('/health' in generateOpenAPI({ router, info }).paths))
  })

  it('should reject a router that is not built by koa-controller', () => {
    const router = new KoaRouter()
    router.get('/health', async ctx => { ctx.body = 'ok' })
    assert.throws(() => generateOpenAPI({ router, info }), {
      name: 'TypeError',
      message: 'generateOpenAPI expects a router built by loadRouter, getRouterSync or getRouterAsync',
    })
    assert.throws(() => generateOpenAPI({ router: {} as any, info }), TypeError)
  })

  it('should not add enumerable properties to the router or its routes', () => {
    const router = routerOf(PostController)
    assert.deepEqual(Object.keys(router).sort(), Object.keys(new KoaRouter()).sort())
    for (const layer of (router as any).stack) {
      for (const handler of layer.stack) assert.deepEqual(Object.keys(handler), [])
    }
  })

  it('should copy components and security to the document', () => {
    const components = { securitySchemes: { bearer: { type: 'http', scheme: 'bearer' } } }
    const security = [{ bearer: [] }]
    const document = generateOpenAPI({ router: routerOf(PostController), info, components, security })
    assert.deepEqual(document.components, components)
    assert.deepEqual(document.security, security)
    assert.deepEqual(Object.keys(document), ['openapi', 'info', 'paths', 'components', 'security'])
  })

  it('should emit one operation per prefix and route with unique operation ids', () => {
    @controller('/a')
    @controller('/b')
    class MultiController {
      @get('/x')
      @post('/x')
      @request('put', '/y/:key')
      @request('all', '/z')
      async handle() {}
    }
    const document = generateOpenAPI({ router: routerOf(MultiController), info })
    assert.deepEqual(Object.keys(document.paths).sort(), ['/a/x', '/a/y/{key}', '/b/x', '/b/y/{key}'])
    // koa-router adds HEAD to GET routes; it is not documented separately.
    assert.deepEqual(Object.keys(document.paths['/a/x']).sort(), ['get', 'post'])
    const ids = Object.values(document.paths).flatMap(item => Object.values(item).map(operation => operation.operationId))
    assert.equal(new Set(ids).size, 6)
    assert.ok(ids.includes('MultiController_handle') && ids.includes('MultiController_handle_6'))
  })

  it('should convert wildcards and expand optional path segments', () => {
    @controller('/files')
    class FileController {
      @get('/:dir/*rest')
      async read() {}

      @get('/list{/:page}')
      async list() {}
    }
    const { paths } = generateOpenAPI({ router: routerOf(FileController), info })
    assert.deepEqual(Object.keys(paths), ['/files/{dir}/{rest}', '/files/list', '/files/list/{page}'])
    assert.deepEqual(paths['/files/{dir}/{rest}'].get.parameters!.map(p => p.name), ['dir', 'rest'])
    assert.equal(paths['/files/list'].get.parameters, undefined)
    assert.equal(paths['/files/list/{page}'].get.operationId, 'FileController_list_2')
  })

  it('should use apiDoc from the class as defaults and from the method as overrides', () => {
    @controller('/docs')
    @apiDoc({ tags: ['docs'], deprecated: true, responses: { 401: { description: 'Not signed in' } } })
    class DocController {
      @get('/a')
      async a() {}

      @get('/b')
      @apiDoc({
        operationId: 'getB',
        tags: ['special'],
        deprecated: false,
        responses: { 200: { description: 'The B', content: { 'application/json': { schema: { type: 'string' } } } } },
      })
      async b() {}
    }
    const { paths } = generateOpenAPI({ router: routerOf(DocController), info })
    assert.deepEqual(paths['/docs/a'].get, {
      operationId: 'DocController_a',
      tags: ['docs'],
      deprecated: true,
      responses: { 401: { description: 'Not signed in' } },
    })
    assert.deepEqual(paths['/docs/b'].get, {
      operationId: 'getB',
      tags: ['special'],
      deprecated: false,
      responses: {
        200: { description: 'The B', content: { 'application/json': { schema: { type: 'string' } } } },
        401: { description: 'Not signed in' },
      },
    })
  })

  it('should not guess parameters for routes that use the deprecated @state', () => {
    @controller('/legacy')
    class LegacyController {
      @post('/:id')
      @state()
      @validateState({ type: 'object', required: ['name'], properties: { name: { type: 'string' } } })
      async update() {}
    }
    const { paths } = generateOpenAPI({ router: routerOf(LegacyController), info })
    assert.deepEqual(paths['/legacy/{id}'].post, {
      operationId: 'LegacyController_update',
      tags: ['LegacyController'],
      parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
      responses: { 200: { description: 'Successful response' }, 400: { description: 'Invalid request' } },
    })
  })

  it('should document inherited routes under the subclass prefix', () => {
    const fields = { id: Type.String({ from: 'params', required: true }) }
    @controller('/parent')
    class ParentController {
      @get('/:id')
      @apiDoc({ summary: 'Get one' })
      @stateInput(fields)
      async show(state: InputType<typeof fields>) { return state }
    }
    @controller('/child')
    class ChildController extends ParentController {}
    class Plain {}

    const { paths } = generateOpenAPI({
      router: routerOf(ParentController, ChildController, Plain, null),
      info,
    })
    assert.deepEqual(Object.keys(paths), ['/parent/{id}', '/child/{id}'])
    assert.equal(paths['/child/{id}'].get.summary, 'Get one')
    // @stateInput alone rejects nothing, so no 400 response is documented.
    assert.deepEqual(paths['/child/{id}'].get.responses, { 200: { description: 'Successful response' } })
    assert.equal(paths['/child/{id}'].get.operationId, 'ChildController_show')
    assert.deepEqual(paths['/child/{id}'].get.parameters, [
      { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
    ])
  })

  it('should produce a JSON-serializable document', () => {
    const document = generateOpenAPI({ router: routerOf(PostController), info })
    assert.deepEqual(JSON.parse(JSON.stringify(document)), document)
  })
})
