# Settings Epic S2: Admin & Security Settings — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Change the admin password from the UI, configure the session TTL, and duplicate agents — the last items the help ever promised that don't exist.

**Design decision (the auth bootstrap question):** **Layered credentials.** The env var (`AGENTBOARD_ADMIN_PASSWORD`) remains required as the *bootstrap and break-glass* credential — env validation, the doctor, and fresh installs keep working unchanged. Once an admin sets a password in the UI, a DB override (`AdminConfig` singleton) takes precedence for login. Lose the UI password → clear the DB row (documented break-glass) and the env password works again. This avoids the chicken-and-egg of DB-only credentials while making rotation a UI operation.

**Architecture:** `AdminConfig` singleton row: `passwordHash` (scrypt, `salt:hash` hex — a slow KDF is right for passwords, unlike the SHA-256 used for high-entropy keys) + `sessionTtlHours` (default 12). `admin-session.ts` derives session tokens from a **credential fingerprint** (DB hash when present, else a digest of the env password) — so changing the password invalidates every session with zero extra bookkeeping. A 30-second in-memory config cache keeps the per-request DB cost negligible (`hasAdminSession` runs on every admin call). New routes: `POST /api/admin/security/password` (verify current → set new), `GET/PUT /api/admin/security/config` (TTL). Agent duplicate: `POST /api/agents/[id]/duplicate` clones the record with a fresh key (returned once). UI: a Security tab in the settings dialog + a duplicate button on agent rows.

**Context (verified):** `admin-session.ts` exports are consumed only by `requireAdminSession` users and `/api/admin/session` (login/status); every test mocks the module full-surface, so making `isAdminAuthConfigured` async ripples only into the session route. Session tokens are currently `digest(password:secret:nonce)` — swapping `password` for the fingerprint preserves the invalidation property.

**Tech Stack:** Prisma 7, node:crypto scrypt, Next.js 16, Zod 4, Bun test

---

### Task 1: AdminConfig + credential layering (TDD)
- [ ] Schema: `AdminConfig { id @default("singleton"), passwordHash String?, sessionTtlHours Int @default(12), updatedAt }`; push + generate.
- [ ] `admin-config.ts`: `scryptHash`/`scryptVerify` (random salt, timing-safe compare), `getAdminConfig()` (30s cache + `invalidateAdminConfigCache()`), `setAdminPassword`, `setSessionTtlHours`. Unit tests: hash roundtrip, wrong password, cache invalidation.
- [ ] `admin-session.ts`: credential fingerprint resolution (DB-first), async `isAdminAuthConfigured`, layered `verifyAdminPassword`, fingerprint-based `buildSessionToken`, TTL-aware `createAdminSession`. Session route updated for async configured-check.
- [ ] Commit.

### Task 2: Security routes + agent duplicate
- [ ] `POST /api/admin/security/password` — admin + CSRF; `{currentPassword, newPassword(min 8)}`; verify current via layered check; persist scrypt hash; sessions implicitly invalidated (client re-logs in).
- [ ] `GET/PUT /api/admin/security/config` — TTL (1–720 h).
- [ ] `POST /api/agents/[id]/duplicate` — admin + CSRF; clones identity/config with name + " (copy)", mints a fresh key, returns `{agent, rawKey}` once.
- [ ] Route tests: wrong current password → 401-equivalent error; TTL bounds; duplicate returns key and copies fields.
- [ ] Commit.

### Task 3: UI
- [ ] Settings dialog gains a **Security** tab (instance-wide, labelled as such): change-password form (current + new + confirm, "you'll be signed out" note) and session-TTL select.
- [ ] Agents tab: duplicate button per row; on success show the new key once (copy-to-clipboard prompt) and refresh the list.
- [ ] Commit.

### Task 4: Wrap-up
- [ ] Help (admin login/session + Settings API/agents sections + S2 roadmap callouts) updated; INSTALL.md notes the layered credential + break-glass; roadmap S2 marked; full verification; commit.

## Out of scope
- Multiple admin users / roles — a different epic entirely.
- Persisting the login rate limiter (still in-memory).
