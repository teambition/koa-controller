import { controller, get, post, state, before, validateState, after } from '../../src'

// Home
@controller('/')
export class HomeController {
  @get('/')
  async getHome() {
    return 'This is home page'
  }

  @get('/about')
  async about() {
    return { message: 'this is a message about me' }
  }

  @get('/error')
  async errored() {
    throw new Error('boom')
  }
}

// user
@controller('/user')
export class UserController {
  
  // http://localhost:3000/123?name=John
  // { id: 123, name: 'John' }
  @get('/:id')
  @state()
  @validateState({
    type: 'object',
    properties: {
      id: { type: 'integer' },
      name: { type: 'string' },
    }
  })
  async getById(state) {
    return state
  }

  @post('/')
  @before(async (ctx) => {
    if (ctx.query.name === 'admin') {
      throw new Error('admin is locked')
    }
  })
  async createUser(state) {
    return { message: 'ok' }
  }
}

export class UserManager {
  async getUser(id: string) {
    return { id, name: 'abc' }
  }
}
