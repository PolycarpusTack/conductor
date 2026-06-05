import { describe, test, expect } from 'bun:test'
import { assertSameOrigin } from '@/lib/csrf'
import { ApiError } from '@/lib/server/api-errors'

function makeReq(origin: string | null, host: string = 'localhost') {
  const headers = new Headers({ host })
  if (origin !== null) headers.set('origin', origin)
  return new Request('http://localhost/api/test', { headers })
}

describe('assertSameOrigin', () => {
  test('passes for matching origin and host', () => {
    expect(() => assertSameOrigin(makeReq('http://localhost'))).not.toThrow()
  })

  test('passes when origin header is absent (non-browser client)', () => {
    expect(() => assertSameOrigin(makeReq(null))).not.toThrow()
  })

  test('throws for cross-origin request', () => {
    expect(() => assertSameOrigin(makeReq('https://evil.com'))).toThrow()
  })

  test('throws ApiError with status 403', () => {
    try {
      assertSameOrigin(makeReq('https://evil.com'))
      expect.unreachable('should have thrown')
    } catch (err) {
      expect(err).toBeInstanceOf(ApiError)
      expect((err as ApiError).status).toBe(403)
    }
  })

  test('throws for malformed origin header', () => {
    expect(() => assertSameOrigin(makeReq('not-a-url'))).toThrow()
  })

  test('passes for matching origin with port', () => {
    expect(() => assertSameOrigin(makeReq('http://localhost:3000', 'localhost:3000'))).not.toThrow()
  })

  test('throws for same hostname but different port', () => {
    expect(() => assertSameOrigin(makeReq('http://localhost:4000', 'localhost:3000'))).toThrow()
  })
})
