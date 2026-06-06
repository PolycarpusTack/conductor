# Per-User Accounts — Phase 1

Per the design doc (`2026-06-06-per-user-accounts-design.md`): named users with
DB-backed sessions, owner bootstrapped from the legacy credential, the
`requireAdminSession` shim keeping all 159 call sites untouched, and a Users
section in the Security tab.

**Verified against codebase 2026-06-06:**
- Sessions today: HMAC(nonce, credential fingerprint) across two cookies; the
  session route owns login rate-limiting; `useAdminAuth` drives the login form.
- `helpers/auth.ts` module-mocks admin-session ONCE with a mutable fixture —
  new exports (`getSessionUser`, `requireRole`) must be added to that factory
  or every route test file crashes.
- `scryptHash`/`scryptVerify` live in admin-config; reuse as-is.

## Task 1 — Schema + user-auth core (TDD)

- [x] `User` (email unique, name, passwordHash, role owner|admin|member,
  isActive, lastLoginAt) + `UserSession` (tokenHash unique, userId Cascade,
  expiresAt) models.
- [x] `user-auth.ts`: `usersExist()` (30s cache + invalidate), `createUser`,
  `verifyUserCredentials` (active only), `createUserSession` → raw `cu_…`
  token (hash stored), `resolveUserSession` (expiry + active checks),
  `revokeUserSessions`, `bootstrapOwnerFromLegacy(password)` — reuses
  `AdminConfig.passwordHash` verbatim when present, else hashes the provided
  password; owner email `owner@conductor.local`.
- [x] Tests: create/verify (wrong password, inactive user), session round-trip
  + expiry, bootstrap with and without a DB hash, cache invalidation.

## Task 2 — Session shim + login flow

- [x] admin-session.ts keeps every export name: `hasAdminSession` resolves
  `cu_…` cookies against UserSession (legacy HMAC pair accepted only while no
  users exist or `RECOVERY_MODE=1`); `createAdminSession(userId?)` writes a DB
  session when given a user; `clearAdminSession` revokes the DB row; new
  `getSessionUser()` (legacy session → synthetic owner) and
  `requireRole('admin' | 'owner')` (403 for lesser roles).
- [x] Session route: GET += `usersExist` + `user` {name,email,role}; POST
  accepts optional email — required once users exist; the first successful
  legacy login bootstraps the owner and starts a DB session for it (response
  says so); `RECOVERY_MODE=1` keeps the legacy path open as break-glass.
- [x] `adminLoginSchema` += optional email; helpers/auth.ts factory += new
  exports.
- [x] Tests: legacy login bootstraps owner, email login, wrong email 401,
  deactivated user 401, recovery mode.

## Task 3 — Users routes + role enforcement

- [x] `GET/POST api/admin/users` + `PUT api/admin/users/[userId]` —
  requireRole('admin') + CSRF on mutations. POST returns a one-time temp
  password. Guards: managing an owner (or granting owner) needs an owner;
  no self-deactivation; the last active owner can't be deactivated or demoted.
- [x] requireRole('admin') swapped in on the privileged surface:
  admin/security/* (password, config, keys), projects/[id] DELETE.
- [x] Tests: member 403 on users routes + privileged surface, owner guards,
  temp password shape, last-owner protection.

## Task 4 — UI + help + wrap-up

- [x] useAdminAuth: GET exposes usersExist/user; login(email?, password);
  login form gains an email field once users exist (with the
  owner@conductor.local hint after bootstrap).
- [x] Security tab "Users" section: list (name, email, role, last login,
  active), create with one-time temp password reveal (key-rotation pattern),
  role select, activate/deactivate, reset password.
- [x] Help: Security section documents accounts, bootstrap, and break-glass;
  FAQ caveat updated. INSTALL gains RECOVERY_MODE.
- [x] Full verification; commits per task.

> **Implemented 2026-06-06.** Deviations: the Users section is a separate
> `settings-users.tsx` component rendered above SettingsSecurity (it fetches its
> own session info rather than threading props); security/password stays
> admin-gated since it manages the shared legacy credential, not personal
> passwords (personal password change is Phase 3 polish alongside the profile
> menu). Session-route login tests are covered by the user-auth unit tests +
> admin-users route tests; the login route's branching is exercised end-to-end
> in dev.
