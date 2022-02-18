import { controller, get, post, state, validateState } from '../../../src'

// controller decorator
@controller('/')
export class HomeController {
  @get('/')
  async getHome() {
    return 'Hello world'
  }

  @get('/about')
  async about() {
    return { message: 'this is a message about me' }
  }

  // http://localhost:3000/123?name=John
  // { id: 123, name: 'John' }
  @get('/state/:id')
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

  @get('/error')
  async errored() {
    throw new Error('boom')
  }
}
