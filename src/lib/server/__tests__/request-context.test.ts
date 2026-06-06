import { describe, test, expect } from 'bun:test'

import {
  runWithRequestContext,
  getRequestUser,
  setRequestUser,
  getAttributionUserId,
} from '../request-context'

describe('request context (Phase 2 attribution)', () => {
  test('outside a context everything is undefined/null', () => {
    expect(getRequestUser()).toBeUndefined()
    expect(getAttributionUserId()).toBeNull()
  })

  test('round-trips a user inside a context', () => {
    runWithRequestContext(() => {
      expect(getRequestUser()).toBeUndefined() // unresolved yet
      setRequestUser({ id: 'u-1', email: 'a@b.c', name: 'A', role: 'admin' })
      expect(getRequestUser()).toMatchObject({ id: 'u-1' })
      expect(getAttributionUserId()).toBe('u-1')
    })
    expect(getRequestUser()).toBeUndefined() // context closed
  })

  test('a resolved-but-absent session is cached as null, not attributed', () => {
    runWithRequestContext(() => {
      setRequestUser(null)
      expect(getRequestUser()).toBeNull()
      expect(getAttributionUserId()).toBeNull()
    })
  })

  test('the synthetic legacy owner is never attributed', () => {
    runWithRequestContext(() => {
      setRequestUser({ id: 'legacy-admin', email: 'admin@legacy', name: 'Admin (legacy)', role: 'owner' })
      expect(getAttributionUserId()).toBeNull()
    })
  })

  test('contexts are isolated across concurrent async flows', async () => {
    const results = await Promise.all([
      runWithRequestContext(async () => {
        setRequestUser({ id: 'u-1', email: 'a@b.c', name: 'A', role: 'admin' })
        await new Promise((r) => setTimeout(r, 5))
        return getAttributionUserId()
      }),
      runWithRequestContext(async () => {
        setRequestUser({ id: 'u-2', email: 'd@e.f', name: 'D', role: 'member' })
        return getAttributionUserId()
      }),
    ])
    expect(results).toEqual(['u-1', 'u-2'])
  })
})
