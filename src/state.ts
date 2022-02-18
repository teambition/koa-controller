import * as lodash from 'lodash'
import { defaultManager } from './router'

export function state(params?: Record<string, string[]>, routerManager = defaultManager) {
  return routerManager.before(async (ctx) => {
    ctx.state = Object.assign({}, ctx.query, ctx.params, ctx.request.body)
    if (params) {
      ctx.state = Object.keys(params).reduce<Record<string, any>>((result, key) => {
        for (const fromPath of params[key]) {
          result[key] = lodash.get(ctx, fromPath, undefined)  
        }
        return result
      }, {})
    }
  })
}
