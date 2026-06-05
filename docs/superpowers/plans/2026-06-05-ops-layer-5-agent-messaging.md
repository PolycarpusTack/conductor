# Ops Layer Epic 5: Agent Messaging — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Agents can send each other durable, task-aware messages without encoding everything into task outputs. Project-scoped inboxes (roadmap D2), agent-key auth for send/read, admin visibility per task/project, content safety on every body. **Messages do not advance chains in v1** — `wait_message` step modes and message triggers are explicitly v1.1.

**Architecture:** Two models: `AgentAddress` (auto-provisioned `name-slug` per agent per project — no management UI in v1) and `AgentMessage` (durable, status `queued → delivered → read`, optional task/step/thread links, `bodySecurity` JSON from the Epic 4 scanner). A pure-ish `agent-messaging.ts` service owns address slugging/provisioning, recipient resolution (same-project only), and security stamping (scan at write; **wrap flagged bodies at delivery** so the stored original stays intact for admin forensics). Agent-key routes mirror the existing agent API auth (`extractAgentApiKey` → `resolveAgentByApiKey`); GET auto-transitions `queued → delivered`. Admin reads ride `requireAdminSession`; admin can post into a task thread (trust `admin`). Realtime: `agent-message-created` / `agent-message-read` project broadcasts (inbox counts derivable client-side; no separate count event in v1).

**Context (verified):** agent auth helpers in `api-keys.ts` (`AgentAuthResult { id, name, emoji, projectId }`); content-safety module from Epic 4 (`ContentSafetyResult` matches the designed `bodySecurity` shape); task drawer uses stacked sections (sessions precedent) — Messages lands as a section, not a tab; `broadcastProjectEvent` for realtime.

**Tech Stack:** Prisma 7, Next.js 16 App Router, TypeScript 5, Zod 4, Bun test

---

## File Map

| File | Change |
|---|---|
| `prisma/schema.prisma` | `AgentAddress`, `AgentMessage` |
| `src/lib/server/agent-messaging.ts` | New — addresses, resolution, send, delivery wrapping |
| `src/lib/server/__tests__/agent-messaging.test.ts` | New |
| `src/app/api/agent/messages/route.ts` | New — GET inbox (auto-deliver), POST send (agent key) |
| `src/app/api/agent/messages/[id]/read/route.ts` | New — POST mark read |
| `src/app/api/tasks/[id]/messages/route.ts` | New — GET thread, POST admin message |
| `src/app/api/projects/[id]/messages/route.ts` | New — GET project messages (admin) |
| `src/lib/server/__tests__/agent-messages-route.test.ts` | New — auth/scoping route tests |
| `src/components/task-messages.tsx` | New — task drawer messages section (+ admin send) |
| `src/components/task-detail-drawer.tsx` | Mount section |

---

### Task 1: Schema
- [ ] `AgentAddress { id, agentId, projectId, address, label?, active, createdAt; @@unique([projectId, address]); @@index([agentId]) }`
- [ ] `AgentMessage { id, projectId, workspaceId?, taskId?, stepId?, threadId?, fromAgentId?, toAgentId?, fromAddress, toAddress, priority=normal, subject?, body, bodySecurity?, status=queued, readAt?, createdAt, deliveredAt?; @@index([projectId, toAgentId, status]); @@index([taskId]); @@index([threadId]) }`
- [ ] push + generate + commit.

### Task 2: agent-messaging service (TDD)
- [ ] `slugifyAddress(name)` — lowercase, dashes, stable.
- [ ] `ensureAgentAddress(agentId, projectId, name)` — upsert by (projectId, slug); returns address.
- [ ] `resolveRecipientByAddress(projectId, address)` — AgentAddress lookup, active only; null for cross-project/unknown.
- [ ] `sendMessage({ from?, fromAddress, toAgent, ..., trust })` — scans body (Epic 4), stores `bodySecurity` JSON `{ trust, flags }`, status `queued`, threadId defaults to own id; broadcasts `agent-message-created`.
- [ ] `presentBody(message)` — returns body wrapped as external-content when flags exist AND trust isn't admin/system; verbatim otherwise (delivery-time wrapping; stored original intact).
- [ ] Tests for all of the above with mocked db.

### Task 3: Agent-key routes
- [ ] `GET /api/agent/messages?status=` — inbox of authenticated agent; auto-transition returned `queued` → `delivered` (+`deliveredAt`); bodies via `presentBody`.
- [ ] `POST /api/agent/messages` — `{ to, body, subject?, taskId?, stepId?, priority?, threadId? }`; sender = authenticated agent (address auto-provisioned); recipient must resolve in the same project; taskId must belong to the project; trust `agent`.
- [ ] `POST /api/agent/messages/[id]/read` — 403 unless addressed to the authenticated agent; sets `read`/`readAt`; broadcasts `agent-message-read`.
- [ ] Route tests: 401 bad key, 404 unknown recipient address, 403 foreign read, send→queued, GET marks delivered, read marks read, flagged body delivered wrapped.

### Task 4: Admin routes + UI
- [ ] `GET /api/tasks/[id]/messages` (admin) — thread for a task, raw bodies + bodySecurity (forensics view).
- [ ] `POST /api/tasks/[id]/messages` (admin + CSRF) — `{ to, body, subject? }` from address `admin@conductor`, trust `admin`.
- [ ] `GET /api/projects/[id]/messages?limit=` (admin).
- [ ] `task-messages.tsx` — section in the task drawer: thread list (from→to, priority, security badge when flagged, relative time), admin send box with recipient select from task's project agents. Renders only when messages exist or compose is opened.
- [ ] Endpoint auth tests for the admin routes.

### Task 5: Wrap-up
- [ ] Full verification; checkboxes; deviations; commit.

## Out of scope (v1.1+)
- `wait_message` step mode and message-driven triggers (`message-created` etc.).
- Inbox counts in the sidebar/agent panel (the API supports deriving them; UI lands with the presence work in Epic 6+).
- Workspace-scoped messaging, address management UI, message retention policies (Settings → Messages).
