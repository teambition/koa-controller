import lodash from 'lodash'
import { before } from './router.js'

/**
 * Creates a method or class decorator that replaces `ctx.state` before the
 * controller method runs.
 *
 * Without a mapping, the new state is a shallow merge of `ctx.query`,
 * `ctx.request.body`, and `ctx.params`, in that order. Later sources overwrite
 * keys from earlier sources.
 *
 * With a mapping, each key is resolved from one or more context paths using
 * `lodash.get`. Paths are evaluated from left to right; when several paths are
 * provided, each value overwrites the previous value, including `undefined`.
 *
 * @param params Map of state property names to context lookup paths. Omit the
 * map to merge query, body, and route parameters into the state.
 * @returns A class or method decorator implemented as a `before` middleware.
 *
 * @example
 * ```ts
 * interface GetUserState {
 *   userId: string
 *   token?: string
 * }
 *
 * @get('/users/:id')
 * @state({
 *   userId: ['params.id'],
 *   token: ['headers.authorization'],
 * })
 * async getUser(state: GetUserState) {
 *   return userService.find(state.userId)
 * }
 * ```
 *
 * @example
 * ```ts
 * @post('/users')
 * @state()
 * async createUser(state) {
 *   // state contains query, request body, and route parameter values.
 *   return userService.create(state)
 * }
 * ```
 */
export function state(params?: Record<string, string[]>) {
  return before(async function stateMW (ctx) {
    if (!params) {
      ctx.state = Object.assign({}, ctx.query, ctx.request.body, ctx.params)
      return
    }
    ctx.state = Object.entries(params).reduce<Record<string, unknown>>((result, [key, fromPaths]) => {
      for (const fromPath of fromPaths) {
        result[key] = lodash.get(ctx, fromPath, undefined)  
      }
      return result
    }, {})
  })
}
