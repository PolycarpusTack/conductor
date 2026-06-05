# Settings Epic S5: Runtime & MCP Operations — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The ops half of runtimes and MCP: a one-click runtime connectivity test (backend exists since v0.0.6), per-runtime usage rollups, MCP tool discovery in the UI, and per-tool enable/disable enforced at dispatch.

**Architecture:** (1) Runtime test = a button in `settings-runtimes` calling the existing `GET /api/admin/runtimes/[id]/health`, showing status + latency inline. (2) Usage = `GET /api/projects/[id]/runtimes/usage`: last-30-days `StepExecution`s joined to agent→runtimeId, aggregated in JS (Prisma groupBy can't traverse relations) into `{runtimeId: {executions, tokens, cost}}`; rendered as a compact line per runtime card. (3) Discovery = `POST /api/projects/[id]/mcp-connections/[cid]/discover` (admin + CSRF) reusing the resolver's `tools/list` fetch, returning raw tool names/descriptions plus each tool's enabled state derived from `scopes`. (4) Enforcement = `fetchToolsFromMcp` filters by the connection's `scopes` allowlist **before namespacing** — `null` scopes = all tools (back-compat), `[]` = none, otherwise listed-only. The PUT route already persists scopes.

**Context (verified):** `/api/admin/runtimes/[id]/health` returns `{status, model, latencyMs, error?}`; `fetchToolsFromMcp` namespaces as `name__tool` after fetch; `mcpConnectionSchema.scopes: z.array(z.string()).optional()` flows through create + PUT (`[cid]/route.ts:27`); `settings-runtimes`/`settings-mcp` are self-contained CRUD panels.

**Tech Stack:** Prisma 7, Next.js 16, TypeScript 5, Bun test

---

### Task 1: Scopes enforcement (TDD)
- [ ] `fetchToolsFromMcp` filters raw tool names by parsed `connection.scopes` (null → all; `[]` → none; else allowlist). Tests in mcp-resolver test file via mock fetch + connection fixtures.
- [ ] Commit.

### Task 2: Discovery + usage endpoints
- [ ] `POST /api/projects/[id]/mcp-connections/[cid]/discover` — admin; calls tools/list; returns `{tools: [{name, description, enabled}]}`; 404 foreign/unknown connection; 502 unreachable server.
- [ ] `GET /api/projects/[id]/runtimes/usage` — admin; 30-day execution aggregation keyed by runtimeId.
- [ ] Endpoint tests (auth + shapes).
- [ ] Commit.

### Task 3: UI
- [ ] settings-runtimes: per-runtime **Test** button (status dot + latency inline) and a usage line (`N runs · X tokens · $Y · 30d`) from the usage endpoint.
- [ ] settings-mcp: per-connection **Tools** expander → discover → checkbox list → **Save** writes `scopes` via existing PUT (all-checked saves null to keep back-compat "no restriction").
- [ ] Commit.

### Task 4: Wrap-up
- [ ] Help (Runtimes/MCP settings sections + roadmap callouts) updated; roadmap S5 marked shipped; full verification; commit.
