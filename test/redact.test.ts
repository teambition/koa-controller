import 'mocha'
import { strict as assert } from 'assert'
import { redactHeaders, redactUrl } from '../src/redact.js'

describe('redact test suite', () => {
  describe('redactHeaders', () => {
    it('should redact default sensitive headers case-insensitively', () => {
      const headers = { Authorization: 'Bearer x', COOKIE: 'a=b', 'X-Api-Key': 'k', accept: '*/*' }
      assert.deepEqual(redactHeaders(headers), {
        Authorization: '[REDACTED]',
        COOKIE: '[REDACTED]',
        'X-Api-Key': '[REDACTED]',
        accept: '*/*',
      })
      assert.equal(headers.Authorization, 'Bearer x')
    })

    it('should redact extra header names', () => {
      assert.deepEqual(redactHeaders({ 'x-tenant-secret': 's', accept: '*/*' }, ['X-Tenant-Secret']), {
        'x-tenant-secret': '[REDACTED]',
        accept: '*/*',
      })
    })

    it('should return an empty object for missing headers', () => {
      assert.deepEqual(redactHeaders(undefined as any), {})
    })
  })

  describe('redactUrl', () => {
    it('should leave a url without a query string unchanged', () => {
      assert.equal(redactUrl('/users/42'), '/users/42')
    })

    it('should redact default sensitive query parameters only', () => {
      assert.equal(
        redactUrl('/cb?Token=abc&page=2&password=p%40ss&empty=&flag'),
        '/cb?Token=[REDACTED]&page=2&password=[REDACTED]&empty=&flag'
      )
    })

    it('should match percent-encoded parameter names', () => {
      assert.equal(redactUrl('/cb?access%5Ftoken=abc'), '/cb?access%5Ftoken=[REDACTED]')
    })

    it('should tolerate malformed percent-encoding', () => {
      assert.equal(redactUrl('/cb?%E0%A4%A=1&token=abc'), '/cb?%E0%A4%A=1&token=[REDACTED]')
    })

    it('should redact extra parameter names', () => {
      assert.equal(redactUrl('/cb?session=abc&page=2', ['session']), '/cb?session=[REDACTED]&page=2')
    })

    it('should return non-string input unchanged', () => {
      assert.equal(redactUrl(undefined as any), undefined)
    })
  })
})
