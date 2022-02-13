import * as lodash from 'lodash'
import { defaultManager } from './router'

export function getState(params?: Record<string, string[]>, routerManager = defaultManager) {
  return routerManager.before(async (ctx) => {
    // define data middleware
    // debug('running define state data')
    // ctx.routePath = routePath
    ctx.state = Object.assign({}, ctx.query, ctx.params, ctx.request.body)
    if (params) {
      const all = {
        params: ctx.params,
        query: ctx.query,
        body: ctx.request.body,
        header: ctx.headers
      }
      ctx.state = Object.keys(params).reduce<Record<string, any>>((result, key) => {
        let value: any = undefined
        result[key] = params[key].find(fromPath => {
          return lodash.get(ctx, fromPath) || undefined
        })
        return result
      }, {})
    }
  })
}
