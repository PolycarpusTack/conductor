# Per-User Accounts — Phases 2 (Attribution) + 3 (Polish), then v0.4.0

**Verified against codebase 2026-06-06:**
- ~16 non-test `db.activityLog.create` sites, mostly agent/daemon/cli paths —
  per-route stamping would be churn for nothing. Instead: an AsyncLocalStorage
  request context populated by `getSessionUser`, and a Prisma **query
  extension** on `activityLog.create` that injects `userId` whenever a request
  user exists. Universal, zero call-site changes; agent/daemon writes stay
  unattributed (no request user in those flows).
- `requireRole` currently resolves the session twice (requireAdminSession →
  getSessionUser, then getSessionUser again) — the ALS store doubles as a
  per-request user cache, fixing that for free.
- Admin task-drawer messages send as the literal `admin@conductor`.

## Task 1 — Attribution plumbing (Phase 2)

- [ ] `ActivityLog.userId String?` + `user User?` (SetNull) + User back-relation.
- [ ] `request-context.ts`: ALS store `{ user?: SessionUser | null }`,
  `runWithRequestContext`, `getRequestUser`, `setRequestUser`.
- [ ] `withErrorHandling` wraps handlers in `runWithRequestContext`.
- [ ] `getSessionUser` caches into / reads from the store (synthetic legacy
  owner is NOT stamped — `legacy-admin` isn't a DB row).
- [ ] db.ts: `$extends` query extension injecting `userId` into
  `activityLog.create` data when absent and a real request user exists.
- [ ] Activity GET includes `user: { name, email }`; ActivityEntry renders
  "· by NAME" in the Activity tab.
- [ ] Admin messages: sender shows the session user's email instead of the
  fixed `admin@conductor` (fallback preserved for legacy sessions).
- [ ] Tests: extension stamping logic (pure helper), context round-trip.

## Task 2 — Account polish (Phase 3)

- [ ] `api/admin/me` route: `PUT` personal password change (verify current,
  scrypt new, revoke OTHER sessions — keep the current one); `DELETE` = sign
  out everywhere (revoke all sessions + clear cookie). Works for every role.
- [ ] Login route: per-email rate bucket alongside the IP bucket.
- [ ] Security tab "Your account" block (renders for members too): change
  password, sign out everywhere.
- [ ] Tests: me route (wrong current 401, revocation), email rate bucket.

## Task 3 — Release v0.4.0

- [ ] package.json 0.3.0 → 0.4.0; help "What's new in 0.4.0" (accounts +
  attribution, recurring tasks, tool usage stats); full verification incl.
  build; release commit + tag.
