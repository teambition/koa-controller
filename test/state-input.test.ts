import 'mocha'
import { strict as assert } from 'assert'
import type { AddressInfo } from 'net'
import Koa from 'koa'
import bodyParser from 'koa-bodyparser'
import { controller, get, post, loadRouter } from '../src/router.js'
import { errorHandlerMW } from '../src/error-handler.js'
import { stateInput, Type } from '../src/state-input.js'
import type { InputType } from '../src/state-input.js'
import { validateState } from '../src/validate.js'

describe('stateInput test suite', () => {
  const CommentFields = {
    id: Type.Number({ from: 'params', required: true }),
    content: Type.String({ required: true }),
    page: Type.Number({ from: 'query' }),
    draft: Type.Boolean({ from: 'query' }),
    tags: Type.Array(Type.String()),
    author: Type.Object({
      name: Type.String({ required: true }),
      age: Type.Number(),
    }),
  }

  @controller('/posts')
  class CommentController {
    @post('/:id/comments')
    @stateInput(CommentFields)
    async create(state: InputType<typeof CommentFields>) {
      return state
    }

    @post('/:id/checked-comments')
    @stateInput(CommentFields)
    @validateState({
      type: 'object',
      required: ['id', 'content'],
      properties: {
        id: { type: 'integer' },
        content: { type: 'string' },
        page: { type: 'integer', minimum: 1 },
        draft: { type: 'boolean' },
        tags: { type: 'array', items: { type: 'string' } },
        author: { type: 'object' },
      },
    })
    async createChecked(state: InputType<typeof CommentFields>) {
      return state
    }

    @get('/:id')
    @stateInput({ id: Type.String({ from: 'params', required: true }), constructor: Type.String() })
    async show(state: { id: string }) {
      return state
    }
  }

  const router = loadRouter({ controllerConstructors: [CommentController] })

  async function call({ method = 'POST', path = '/posts/42/comments', query = {}, body, state }: {
    method?: string
    path?: string
    query?: Record<string, unknown>
    body?: unknown
    state?: unknown
  }) {
    const ctx: any = { method, path, headers: {}, query, request: { body }, state }
    await router.routes()(ctx, (() => {}) as any)
    return ctx
  }

  it('should build state from params, query and body', async () => {
    const author = { name: 'Ann', age: 30 }
    const ctx = await call({
      query: { page: '2', draft: 'true' },
      body: { content: 'hello', tags: ['a', 'b'], author },
    })
    assert.deepEqual(ctx.body, {
      id: '42',
      content: 'hello',
      page: '2',
      draft: 'true',
      tags: ['a', 'b'],
      author,
    })
  })

  it('should copy values as they arrive, without converting or checking them', async () => {
    // `id` and `page` are declared as numbers, `content` is required.
    const ctx = await call({ path: '/posts/abc/comments', query: { page: 'two' }, body: { tags: 'not-an-array' } })
    assert.deepEqual(ctx.body, { id: 'abc', page: 'two', tags: 'not-an-array' })
  })

  it('should leave out fields that are not sent', async () => {
    const ctx = await call({ body: { content: 'hello' } })
    assert.deepEqual(ctx.body, { id: '42', content: 'hello' })
  })

  it('should copy only declared fields', async () => {
    const ctx = await call({ query: { other: '1' }, body: { content: 'hello', role: 'admin' } })
    assert.deepEqual(ctx.body, { id: '42', content: 'hello' })
  })

  it('should read each field only from its declared source', async () => {
    // `id` and `page` are sent in the body, `content` in the query.
    const ctx = await call({ query: { content: 'from query' }, body: { id: 7, page: 9 } })
    assert.deepEqual(ctx.body, { id: '42' })
  })

  it('should replace the previous ctx.state', async () => {
    const ctx = await call({ body: { content: 'hello' }, state: { user: 'ann' } })
    assert.deepEqual(ctx.state, { id: '42', content: 'hello' })
  })

  it('should not read inherited properties of the source', async () => {
    const ctx = await call({ method: 'GET', path: '/posts/abc', body: {} })
    assert.deepEqual(ctx.body, { id: 'abc' })
  })

  it('should accept a request without a body', async () => {
    const ctx = await call({ method: 'GET', path: '/posts/abc' })
    assert.deepEqual(ctx.body, { id: 'abc' })
  })

  describe('with validateState', () => {
    const path = '/posts/42/checked-comments'

    it('should let validateState convert and check the state it built', async () => {
      const ctx = await call({ path, query: { page: '2', draft: 'true' }, body: { content: 'hello' } })
      assert.deepEqual(ctx.body, { id: 42, content: 'hello', page: 2, draft: true })
    })

    it('should let validateState reject missing and invalid fields', async () => {
      await assert.rejects(call({ path, body: {} }), { status: 400, message: "/ must have required property 'content'" })
      await assert.rejects(
        call({ path: '/posts/abc/checked-comments', body: { content: 'hello' } }),
        { status: 400, message: '/id must be integer' }
      )
      await assert.rejects(
        call({ path, query: { page: '1.5' }, body: { content: 'hello' } }),
        { status: 400, message: '/page must be integer' }
      )
      await assert.rejects(
        call({ path, query: { page: '0' }, body: { content: 'hello' } }),
        { status: 400, message: '/page must be >= 1' }
      )
    })

    it('should not let a body field be supplied through the query string', async () => {
      await assert.rejects(
        call({ path, query: { content: 'from query' }, body: {} }),
        { status: 400, message: "/ must have required property 'content'" }
      )
    })
  })

  it('should work with a real Koa app, body parser and error handler', async () => {
    const app = new Koa()
    app.use(errorHandlerMW())
    app.use(bodyParser())
    app.use(router.routes())
    const server = app.listen(0)
    try {
      const { port } = server.address() as AddressInfo
      const send = (url: string, body: unknown) => fetch(`http://127.0.0.1:${port}${url}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      })

      const plain = await send('/posts/7/comments?page=3', { content: 'hi', id: 99 })
      assert.equal(plain.status, 200)
      assert.deepEqual(await plain.json(), { id: '7', content: 'hi', page: '3' })

      const checked = await send('/posts/7/checked-comments?page=3&draft=false', { content: 'hi', id: 99 })
      assert.equal(checked.status, 200)
      assert.deepEqual(await checked.json(), { id: 7, content: 'hi', page: 3, draft: false })

      const bad = await send('/posts/7/checked-comments?page=x', { content: 'hi' })
      assert.equal(bad.status, 400)
      assert.deepEqual(await bad.json(), { error: '/page must be integer' })
    } finally {
      server.close()
    }
  })

  describe('Type', () => {
    it('should describe fields that are optional and unsourced by default', () => {
      assert.deepEqual(Type.String(), { schema: { type: 'string' }, required: false })
      assert.deepEqual(Type.Number({ from: 'query', required: true }), {
        schema: { type: 'number' }, required: true, from: 'query',
      })
      assert.deepEqual(Type.Boolean().schema, { type: 'boolean' })
      assert.deepEqual(Type.Array(Type.Number()).schema, { type: 'array', items: { type: 'number' } })
      assert.deepEqual(Type.Enum(['a', 'b']).schema, { type: 'string', enum: ['a', 'b'] })
      assert.deepEqual(Type.Enum(['a', 1]).schema, { enum: ['a', 1] })
      assert.deepEqual(Type.Union([Type.String(), Type.Number(), Type.String()]).schema, { type: ['string', 'number'] })
      assert.deepEqual(Type.Object({ a: Type.String({ required: true }), b: Type.Number() }).schema, {
        type: 'object',
        properties: { a: { type: 'string' }, b: { type: 'number' } },
        required: ['a'],
      })
    })

    it('should reject an unknown source', () => {
      assert.throws(() => Type.String({ from: 'headers' as any }), /Invalid "from" value "headers"/)
    })

    it('should reject a source on nested fields', () => {
      assert.throws(() => Type.Object({ a: Type.String({ from: 'query' }) }), /only allowed on top-level fields.*"a"/)
      assert.throws(() => Type.Array(Type.String({ from: 'query' })), /only allowed on top-level fields/)
      assert.throws(() => Type.Union([Type.String({ from: 'query' }), Type.Number()]), /only allowed on top-level fields/)
    })

    it('should reject an empty enum', () => {
      assert.throws(() => Type.Enum([]), /at least one value/)
    })

    it('should reject unsupported union members', () => {
      assert.throws(() => Type.Union([Type.String(), Type.Array(Type.String())]), /only accepts Type.String/)
      assert.throws(() => Type.Union([Type.String(), Type.Enum(['a'])]), /only accepts Type.String/)
      assert.throws(() => Type.Union([Type.String()]), /at least two different member types/)
    })
  })
})
