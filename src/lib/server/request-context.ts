// Per-request context (Phase 2 attribution). withErrorHandling opens a store
// for every route invocation; getSessionUser caches the resolved user here —
// which both kills the double session lookup in requireRole AND lets the
// activityLog Prisma extension stamp the acting user without any call-site
// churn. Agent/daemon/cron flows never set a user, so their writes stay
// unattributed, exactly as intended.

import { AsyncLocalStorage } from 'async_hooks'

export interface RequestUser {
  id: string
  email: string
  name: string
  role: string
}

interface RequestStore {
  // undefined = not resolved yet; null = resolved, no session
  user: RequestUser | null | undefined
}

const storage = new AsyncLocalStorage<RequestStore>()

export function runWithRequestContext<T>(fn: () => T): T {
  return storage.run({ user: undefined }, fn)
}

/** The cached session user; `undefined` when unresolved or outside a request. */
export function getRequestUser(): RequestUser | null | undefined {
  return storage.getStore()?.user
}

export function setRequestUser(user: RequestUser | null): void {
  const store = storage.getStore()
  if (store) store.user = user
}

/**
 * The userId to stamp on attribution columns — only real DB users count
 * (the synthetic legacy-admin owner isn't a row anyone can join against).
 */
export function getAttributionUserId(): string | null {
  const user = storage.getStore()?.user
  if (!user || user.id === 'legacy-admin') return null
  return user.id
}
