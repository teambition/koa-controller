import * as lodash from 'lodash'
import { before } from './router'

export function state(params?: Record<string, string[]>) {
  return before(async function stateMW (ctx) {
    if (!params) {
      ctx.state = Object.assign({}, ctx.query, ctx.request.body, ctx.params)
      return
    }
    ctx.state = Object.entries(params).reduce<Record<string, any>>((result, [key, fromPaths]) => {
      for (const fromPath of fromPaths) {
        result[key] = lodash.get(ctx, fromPath, undefined)  
      }
      return result
    }, {})
  })
}
