# ADR-0005: Three-plane authentication

Status: Accepted

Date: 2026-07-04

## Context

Conductor is accessed by three fundamentally different kinds of caller, and
collapsing them into one credential model would be both insecure and unusable:

1. **Humans** using the web UI (owners/admins/members).
2. **External integrations** — CI pipelines, scripts, webhooks — calling the
   REST API without a browser.
3. **Machine workers** — the conductor daemon (and pull-model agents) that lease
   and execute work.

Each needs different revocation, scoping, and CSRF/SSRF properties.

## Decision

Three distinct auth planes, each with its own credential shape and storage:

- **Plane 1 — admin/user sessions (cookie, hashed).** Users authenticate to a
  session cookie; `requireAdminSession` gates session-authenticated routes
  (`src/lib/server/api-auth.ts`). Passwords are scrypt-hashed (`AdminConfig` /
  `User.passwordHash`, `salt:hash`); session tokens are stored hashed. For
  mutating scopes the CSRF origin check applies to cookie auth only
  (`assertSameOrigin`, `src/lib/csrf.ts`) — it compares the `Origin` host to
  the request host and lets non-browser clients (no `Origin` header) through,
  because they are not riding an ambient browser cookie.
- **Plane 2 — agent & scoped integration API keys (SHA-256).** Agent keys and
  project/integration keys are structured (`ab_agent.<id>.<secret>` etc.),
  stored as SHA-256 hashes and compared timing-safe
  (`src/lib/server/api-keys.ts`, `scoped-api-keys.ts`). The raw key is shown
  once at issue time. Scoped keys carry coarse scope strings and are validated
  per required scope (`validateApiKey`). A presented Bearer key is authoritative
  — `authorizeAdminOrScopedKey` never silently falls back to the session when a
  key is presented. Legacy plaintext keys are auto-migrated to hashes on first
  use.
- **Plane 3 — daemon tokens + scoped keys.** Daemons authenticate with a
  structured `cd_daemon.<id>.<secret>` token, stored SHA-256-hashed and resolved
  per request (`src/lib/server/daemon-auth.ts`). After B-4, scoped API keys are
  **project-bound**: `ApiKey.projectId` binds a key to one project and
  `assertKeyProjectAccess` (`api-auth.ts`) returns 403 when a key targets a
  different project. An unbound legacy key keeps instance-wide behaviour but
  logs a deprecation warning and writes a `scoped_key_unbound_deprecated`
  activity row (a migration path, not a permanent affordance).

**Cross-cutting network guards.** Session mutations get the CSRF origin check
above. Outbound admin-configured URLs (webhook/HTTP-reaction runtime adapters)
pass through the SSRF guard `isSafeExternalUrl` (`src/lib/server/url-safety.ts`),
which blocks loopback/private/link-local/multicast IPv4 and IPv6 (including AWS
IMDS `169.254.169.254` and IPv4-mapped IPv6 forms) and non-http(s) protocols,
bypassable only via `AGENTBOARD_ALLOW_LOCAL_WEBHOOK=1` for local dev.

## Consequences

- Each caller class has independent revocation and blast radius: revoke a scoped
  key without touching sessions; a stolen agent key can't ride CSRF; a session
  can't be replayed server-to-server.
- Project binding (B-4) turns a formerly instance-wide scoped key into a
  project-scoped grant, closing the "one key reads every project" gap while
  keeping legacy keys working (with a loud deprecation trail).
- SSRF protection is defense-in-depth and explicitly does **not** close DNS
  rebinding (documented in `url-safety.ts`); the production-grade control is an
  egress firewall.
- The three planes share one authorization entry point for API routes
  (`authorizeAdminOrScopedKey`) that reports *which* plane authenticated, so
  content-safety code can treat key-originated content as untrusted.
- Known hardening still open (EPIC G): reviewer-identity binding on sign-offs,
  purge of remaining legacy plaintext keys, and a rate limiter.
</content>
