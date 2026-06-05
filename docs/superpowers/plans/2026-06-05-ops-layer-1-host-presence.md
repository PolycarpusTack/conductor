# Ops Layer Epic 1: Host Presence — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make machines first-class: a `Host` is a durable machine identity, a `Daemon` is a process running on one. Admins see which hosts exist, which are online, and what's running where — before any session/terminal work lands in Epic 2.

**Architecture:** Additive `Host` model linked from `Daemon` (`hostId` nullable for legacy rows). Daemon registration upserts the host (keyed by a daemon-persisted installation ID per roadmap decision D1, hostname slug as fallback); heartbeat refreshes both `Daemon.lastSeenAt` and `Host.lastSeenAt` and accepts lightweight metrics. New admin read APIs `/api/hosts` + `/api/hosts/[id]`, surfaced as a Hosts tab in the Runtime Dashboard. Backfill script creates one host per existing daemon. Status derivation (`online | stale | offline`) reuses the daemon staleness sweep thresholds in `daemon-auth.ts`.

**Context (verified against v0.0.6):** `Daemon` lives in `prisma/schema.prisma:353` (workspace-scoped, tokenHash auth). `POST /api/daemon/register` is admin-session-gated and returns the daemon token once; `POST /api/daemon/heartbeat` is daemon-token-gated via `resolveDaemonByToken`/`updateDaemonHeartbeat` in `src/lib/server/daemon-auth.ts`. `sweepStaleDaemonsThrottled` already flips dead daemons to `stale` — host status derives from the same data. Zod contracts live in `src/lib/server/daemon-contracts.ts`. Runtime Dashboard is `src/components/runtime-dashboard.tsx`.

**Tech Stack:** Prisma 7, Next.js 16 App Router, TypeScript 5, Zod 4, Bun test

> **Implemented 2026-06-05.** Deviations from the plan as written:
> - Host status thresholds are deliberately MORE lenient than the daemon sweep (online <2 min, stale <10 min vs the daemon's 30s) rather than identical — a machine shouldn't flap offline because one heartbeat was late. Constants live in `host-presence.ts` with a comment relating them to the daemon cadence.
> - Heartbeat metrics reuse the existing `daemonHealthSchema` (extended with optional `activeSessions`) instead of adding a parallel `metrics` object — daemons already send cpuPct/memMb/runningTasks there.
> - Register-with-host and heartbeat-touches-host behavior is covered by the host-presence unit tests (the daemon route layer is a thin pass-through); no separate daemon route test file was added.
> - `trustLevel` is set at host creation and never overwritten by re-register — admin-managed after that.

---

## File Map

| File | Change |
|---|---|
| `prisma/schema.prisma` | New `Host` model; `Daemon.hostId` + `Daemon.sessionCapabilities` (reserved for Epic 2) |
| `src/lib/server/daemon-contracts.ts` | Extend `registerDaemonSchema` with optional `host` object; heartbeat schema gains optional `metrics` |
| `src/lib/server/host-presence.ts` | New — `upsertHostForDaemon()`, `touchHost()`, `deriveHostStatus()` |
| `src/app/api/daemon/register/route.ts` | Upsert host, link `daemon.hostId` |
| `src/app/api/daemon/heartbeat/route.ts` | Touch host lastSeenAt; store metrics into `Host.metadata` |
| `src/app/api/hosts/route.ts` | New — GET list (admin session OR scoped key `read`) |
| `src/app/api/hosts/[id]/route.ts` | New — GET detail with daemons + recent activity |
| `scripts/backfill-hosts.ts` | New — one Host per legacy daemon (hostname slug) |
| `src/components/runtime-dashboard.tsx` | Hosts tab |
| `src/components/host-card.tsx` | New — host status card |
| `src/lib/server/__tests__/host-presence.test.ts` | New — upsert/touch/status unit tests |
| `src/__tests__/api/hosts.test.ts` | New — endpoint auth tests (401/200), follows established helper pattern |

---

### Task 1: Schema — Host model + Daemon link

- [x] **Step 1: Add `Host` and extend `Daemon` in `prisma/schema.prisma`**

```prisma
model Host {
  id          String    @id @default(cuid())
  workspaceId String
  workspace   Workspace @relation(fields: [workspaceId], references: [id], onDelete: Cascade)
  slug        String    // daemon-persisted installation ID, or normalized hostname (legacy)
  displayName String
  hostname    String
  platform    String
  arch        String?
  labels      String?   // JSON string[]
  trustLevel  String    @default("local") // local | lan | remote | cloud
  status      String    @default("offline") // online | stale | offline (derived, denormalized for list queries)
  lastSeenAt  DateTime?
  metadata    String?   // JSON: cpu/memory/os release + latest heartbeat metrics
  createdAt   DateTime  @default(now())
  updatedAt   DateTime  @updatedAt
  daemons     Daemon[]

  @@unique([workspaceId, slug])
  @@index([workspaceId, status])
}
```

On `Daemon` add:

```prisma
hostId              String?
host                Host?   @relation(fields: [hostId], references: [id], onDelete: SetNull)
sessionCapabilities String? // JSON — reserved for Epic 2; written by register when provided
```
plus `@@index([hostId])`. Add `hosts Host[]` to `Workspace`.

- [x] **Step 2:** `bun run db:push && bun run db:generate`
- [x] **Step 3:** Type-check clean.
- [x] **Step 4:** Commit `feat(schema): add Host model and Daemon.hostId for machine presence`.

---

### Task 2: host-presence service (TDD)

- [x] **Step 1: Failing tests** in `src/lib/server/__tests__/host-presence.test.ts` (mock `@/lib/db` with FULL export surface — `{ db, isPostgresDb }`):
  - `upsertHostForDaemon` creates a host keyed by `(workspaceId, slug)` and returns its id
  - second call with same slug updates `hostname/platform/lastSeenAt`, does not duplicate
  - slug falls back to normalized hostname when no installation id provided
  - `touchHost` updates `lastSeenAt` + merges heartbeat metrics into `metadata`, sets status `online`
  - `deriveHostStatus(lastSeenAt)` → `online` (<2 min), `stale` (<10 min), `offline` (else) — thresholds shared with daemon staleness constants
- [x] **Step 2:** Implement `src/lib/server/host-presence.ts`. Export the threshold constants from one place (reuse/move the values used by `sweepStaleDaemonsThrottled` so daemon and host agree).
- [x] **Step 3:** Tests green; commit `feat: add host-presence service (upsert, touch, status derivation)`.

---

### Task 3: Wire register + heartbeat

- [x] **Step 1:** Extend `registerDaemonSchema` with optional `host: { installationId?, displayName?, hostname, platform, arch?, labels?, trustLevel?, metadata? }`. Heartbeat schema gains optional `metrics: { activeSessions?, inFlightSteps?, cpuPct?, memoryMb? }`.
- [x] **Step 2:** In `register/route.ts`: after daemon create, `upsertHostForDaemon()` and set `daemon.hostId`. Legacy daemons (no `host` in payload) still register fine with `hostId = null`.
- [x] **Step 3:** In `heartbeat/route.ts`: after `updateDaemonHeartbeat`, `touchHost(daemon.hostId, metrics)` when linked.
- [x] **Step 4:** Existing daemon route tests still green; add cases: register-with-host links hostId; heartbeat touches host.
- [x] **Step 5:** Commit `feat: upsert Host on daemon register; refresh host presence on heartbeat`.

---

### Task 4: Host read APIs

- [x] **Step 1:** `GET /api/hosts?workspaceId=` — `requireAdminOrScopedKey(request, 'read')`. Returns hosts with daemon count, derived status, lastSeenAt, capabilities rollup. Status computed via `deriveHostStatus` at read time (denormalized column refreshed opportunistically).
- [x] **Step 2:** `GET /api/hosts/[id]` — host detail + daemons + (placeholder) sessions array for Epic 2 forward-compat.
- [x] **Step 3:** Endpoint auth tests in `src/__tests__/api/hosts.test.ts` using the existing `setSession`/`makeRequest` helpers: 401 unauthenticated, 200 admin, 200 scoped read key, 404 unknown id.
- [x] **Step 4:** Commit `feat: add /api/hosts list and detail endpoints`.

---

### Task 5: Hosts tab in Runtime Dashboard

- [x] **Step 1:** New `src/components/host-card.tsx`: status dot (online/stale/offline), hostname + platform/arch, capability badges, daemon count, last heartbeat (relative), trust level chip.
- [x] **Step 2:** Add a `Hosts` tab to `runtime-dashboard.tsx` (alongside existing daemon view) fetching `/api/hosts`; empty state explains that hosts appear when a daemon registers with host info.
- [x] **Step 3:** Type-check + lint + full tests green.
- [x] **Step 4:** Commit `feat(ui): hosts tab with presence cards in runtime dashboard`.

---

### Task 6: Backfill + docs

- [x] **Step 1:** `scripts/backfill-hosts.ts` — for each daemon with `hostId = null`, upsert `Host(workspaceId, slug = normalized hostname)` and link. Idempotent; run with `bun scripts/backfill-hosts.ts`.
- [x] **Step 2:** Note the daemon contract extension (host object, heartbeat metrics, installation-ID guidance) in `docs/` daemon docs if present, else in the plan's deviation note.
- [x] **Step 3:** Full verification; commit `chore: backfill Host rows for legacy daemons`.

---

## Out of scope (later epics)

- `AgentSession` and any session/terminal data (Epic 2/3) — `sessionCapabilities` column is written but unread.
- Realtime `host-status`/`host-metrics` events — Epic 2 introduces the session event plumbing; host events ride along then. The Hosts tab polls in this epic.
- Host trust-level *enforcement* (only stored + displayed for now).
