import 'mocha'
import { strict as assert } from 'assert'
import { mkdtempSync, writeFileSync, rmSync } from 'fs'
import { join } from 'path'
import { controller, get, post, request, loadControllersAsync, loadControllersSync, loadRouter } from '../src/router.js'
import { stateInput, Type } from '../src/state-input.js'
import type { InputType } from '../src/state-input.js'
import { validateState } from '../src/validate.js'
import { state } from '../src/state.js'
import { apiDoc, generateOpenAPI } from '../src/openapi.js'

describe('openapi test suite', () => {
  const info = { title: 'Test API', version: '1.2.3' }

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
    const document = generateOpenAPI({ controllerConstructors: [PostController], info })
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
    const document = generateOpenAPI({ controllerConstructors: [PostController], info })
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

  it('should apply the prefix and servers options', () => {
    const servers = [{ url: 'https://api.example.com' }]
    const document = generateOpenAPI({ controllerConstructors: [PostController], info, prefix: '/v1', servers })
    assert.deepEqual(Object.keys(document.paths), ['/v1/posts/{id}/comments', '/v1/posts', '/v1/posts/{id}'])
    assert.deepEqual(document.servers, servers)
  })

  it('should copy components and security to the document', () => {
    const components = { securitySchemes: { bearer: { type: 'http', scheme: 'bearer' } } }
    const security = [{ bearer: [] }]
    const document = generateOpenAPI({ controllerConstructors: [PostController], info, components, security })
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
      @request('put', '/y/:key(\\d+)')
      @request('link', '/z')
      async handle() {}
    }
    const document = generateOpenAPI({ controllerConstructors: [MultiController], info })
    assert.deepEqual(Object.keys(document.paths).sort(), ['/a/x', '/a/y/{key}', '/b/x', '/b/y/{key}'])
    assert.deepEqual(Object.keys(document.paths['/a/x']).sort(), ['get', 'post'])
    const ids = Object.values(document.paths).flatMap(item => Object.values(item).map(operation => operation.operationId))
    assert.equal(new Set(ids).size, 6)
    assert.ok(ids.includes('MultiController_handle') && ids.includes('MultiController_handle_6'))
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
    const { paths } = generateOpenAPI({ controllerConstructors: [DocController], info })
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
    const { paths } = generateOpenAPI({ controllerConstructors: [LegacyController], info })
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
      controllerConstructors: [ParentController, ChildController, Plain as any, null as any],
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
    const document = generateOpenAPI({ controllerConstructors: [PostController], info })
    assert.deepEqual(JSON.parse(JSON.stringify(document)), document)
  })

  describe('loadControllers', () => {
    let tmpDir: string
    beforeEach(() => { tmpDir = mkdtempSync(join(process.cwd(), '.test-tmp-')) })
    afterEach(() => { rmSync(tmpDir, { recursive: true, force: true }) })

    const source = `
import { controller, get, stateInput, Type } from '../src/index.js'

@controller('/files')
export class FileController {
  @get('/:name')
  @stateInput({ name: Type.String({ from: 'params', required: true }) })
  async show(state: { name: string }) { return state }
}
`

    it('should load controllers for generateOpenAPI with loadControllersAsync', async () => {
      writeFileSync(join(tmpDir, 'file.ts'), source)
      const controllerConstructors = await loadControllersAsync({ cwd: tmpDir, files: '**/*.ts' })
      assert.deepEqual(controllerConstructors.map(c => c.name), ['FileController'])
      const { paths } = generateOpenAPI({ controllerConstructors, info })
      assert.deepEqual(Object.keys(paths), ['/files/{name}'])
    })

    it('should load controllers with loadControllersSync', () => {
      writeFileSync(join(tmpDir, 'b.cjs'), 'exports.B = class B {}; exports.other = 1')
      writeFileSync(join(tmpDir, 'a.cjs'), 'module.exports = class A {}')
      const controllerConstructors = loadControllersSync({ cwd: tmpDir, files: '**/*.cjs' })
      assert.deepEqual(controllerConstructors.map(c => c.name), ['A', 'B'])
    })
  })
})
