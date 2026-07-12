import { controller, get } from '@tng/koa-controller'

// Home
@controller('/')
export class HomeController {
  @get('/')
  async index() {
    return 'This is home page'
  }

  @get('/hello')
  async hello() {
    return 'Hello from ESM project!'
  }
}
