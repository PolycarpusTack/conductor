# Per-User Accounts (Design)

**Status: design doc — no implementation this round.**

The FAQ's standing caveat: "there's a single shared admin password today; per-user
accounts are on the roadmap." This design replaces that password with named users
while keeping every existing auth surface (agent keys, daemon tokens, scoped
integration keys) untouched.

## Current state (verified 2026-06-06)

- **One credential, one identity.** `verifyAdminPassword` checks the layered
  credential (AdminConfig scrypt hash overriding `ADMIN_PASSWORD`); a stateless
  HMAC cookie carries the session, fingerprinted to the credential so a password
  change invalidates all sessions (Epic S2).
- **159 call sites across 61 route files** gate on `requireAdminSession()` —
  whatever replaces it must be a drop-in.
- **No attribution.** ActivityLog has `agentId` but nothing for humans; every
  admin action is anonymous.
- Realtime tokens, CSRF (`assertSameOrigin`), agent/daemon/scoped keys: all
  orthogonal, all unchanged.

## Design

### Identity & sessions

```prisma
model User {
  id           String        @id @default(cuid())
  email        String        @unique
  name         String
  passwordHash String        // scrypt "salt:hash" — reuse admin-config helpers
  role         String        @default("member") // owner | admin | member
  isActive     Boolean       @default(true)
  lastLoginAt  DateTime?
  sessions     UserSession[]
  createdAt    DateTime      @default(now())
  updatedAt    DateTime      @updatedAt
}

model UserSession {
  id        String   @id @default(cuid())
  tokenHash String   @unique // SHA-256 of the cookie value
  userId    String
  user      User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  expiresAt DateTime
  createdAt DateTime @default(now())
  @@index([userId])
}
```

Sessions move from stateless HMAC to **DB-backed** tokens: multi-user demands
per-user revocation ("deactivate this person now", "sign out everywhere"), which
fingerprinting can't express. Cookie value = random 256-bit token; only its hash
is stored. TTL keeps honoring `AdminConfig.sessionTtlHours`.

### Roles (deliberately minimal)

| Role | Can do |
|---|---|
| `owner` | everything; manage users incl. other admins; can't be deactivated by non-owners |
| `admin` | everything except managing owners |
| `member` | day-to-day board/settings work; NOT: Security tab, user management, project delete, admin config |

No per-project membership in v1 — every user sees every project (matches today's
reality). Project-level ACLs are a later, separate design.

### The shim — keeping 159 call sites working

`requireAdminSession()` keeps its exact signature (null = authorized, response =
401) but resolves a `UserSession` row. A new `requireRole('admin')` wraps it for
the handful of privileged routes (security/*, user management, project DELETE).
Member-blocked routes are an enumerable list (~8 files), not a sweep.

`getSessionUser()` (new) returns `{ id, name, email, role } | null` for
attribution and UI.

### Migration & bootstrap — no flag-day

1. **Owner bootstrap from the existing credential.** `AdminConfig.passwordHash`
   is already scrypt "salt:hash" — the migration creates
   `owner@conductor.local` with that exact hash. Whoever knows today's admin
   password owns the instance. (Env-var-only deployments: first login with the
   env password auto-creates the owner with a fresh hash of it.)
2. **Legacy login window.** The password-only login keeps working until at
   least one user row exists; after that, the login form requires email +
   password and the legacy path returns "use your account".
3. **Break-glass.** `ADMIN_PASSWORD` env var stays honored when
   `users.count == 0 || RECOVERY_MODE=1` — a locked-out instance is recoverable
   by someone with shell access, documented in INSTALL.

### Attribution

- `ActivityLog.userId String?` (SetNull) + the acting user stamped by every
  admin mutation (the `withErrorHandling` wrapper can put the session user in
  request context so routes don't all change).
- Activity tab shows "who" next to "what"; task drawer messages from
  `admin@conductor` become `name@conductor`.
- Realtime token gains a `userId` claim (display-only for now).

### UI

- Login: email + password (legacy single-field until first user exists).
- Security tab gains **Users**: list (name, email, role, last login, active),
  create (temporary password shown once, same pattern as API-key rotation),
  role change, deactivate/reactivate, force-reset.
- Header avatar menu: profile (name/password change), sign out, sign out
  everywhere.

## What this is NOT (v1)

- No OAuth/SSO, no email invites (no SMTP dependency in core; the send:email
  reaction config is project-scoped, not instance-scoped).
- No per-project permissions, no audit-grade RBAC.
- No API tokens per user — scoped integration keys already cover automation.

## Phases

| Phase | Scope | Size |
|---|---|---|
| 1 | models, DB sessions, login, shim + requireRole, owner bootstrap + legacy window + break-glass, Users UI | ~2 sessions |
| 2 | attribution end-to-end (ActivityLog.userId, activity/task-drawer surfacing, realtime claim) | ~1 session |
| 3 | polish: sign-out-everywhere, per-user rate limiting on login, FAQ/help/INSTALL updates | ~0.5 session |

Phase 1 is the unlock; 2 and 3 are incremental. The test surface to watch:
`helpers/auth.ts` mocks `admin-session` globally — the shim keeps its export
names precisely so the existing 480-test suite stays green, with new
user-session tests alongside.
