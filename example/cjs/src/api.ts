const { controller, get } = require('@tng/koa-controller')

// Home
@controller('/')
class HomeController {
  @get('/')
  async index() {
    return 'This is home page'
  }

  @get('/hello')
  async hello() {
    return 'Hello from CJS project!'
  }
}

module.exports = { HomeController }
