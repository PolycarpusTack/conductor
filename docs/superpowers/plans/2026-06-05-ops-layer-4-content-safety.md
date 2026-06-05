# Ops Layer Epic 4: Content Safety — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Untrusted inbound content is scanned for prompt-injection patterns and wrapped as data before it can reach an LLM prompt. Three real vectors exist today: **MCP tool results** (looped straight back into the LLM conversation), **scoped-key-created tasks** (webhooks can write task descriptions that dispatch interpolates into prompts — a vector this session created in v0.0.6), and **trigger payloads** (mustache-rendered into reaction configs).

**Architecture:** A pure `content-safety.ts` module: `scanForPromptInjection(text)` returns categorized flags from a conservative pattern list (instruction-override, role-hijack, prompt-exfiltration, tool-abuse); `wrapExternalContent({text, source, sender, trust})` wraps in an `<external-content>` envelope with a DATA-ONLY banner and returns flags. Integration is **scan-always, wrap-when-flagged** — trusted-looking content passes through byte-identical, so behavior only changes when something suspicious arrives. Call sites: `executeMcpTool` (wrap flagged text results), `POST /api/tasks` via scoped key (wrap flagged description, warn to activity log — requires `api-auth` to report *which* path authenticated), and `executeReactions` (scan event payload once; log + expose `security` in the mustache context).

**Context (verified):** MCP text results assembled in `mcp-resolver.ts` `executeMcpTool` (textParts join); task creation prompt-interpolation via `resolvePrompt`/`taskContext` in `dispatch.ts`; `requireAdminOrScopedKey` currently returns only `Response | null` (no path info); reactions render mustache from `context.event` in `reactions/executor.ts`. No `trusted` flag exists on `ProjectMcpConnection` — deferred (see out-of-scope).

**Tech Stack:** TypeScript 5, Bun test

> **Implemented 2026-06-05.** Deviations from the plan as written:
> - The wrapper also neutralizes nested `</external-content>` tags in the body (escaped to entities) so wrapped content cannot fake an early envelope close and smuggle "trusted" text after it — not in the original design but an obvious bypass otherwise.
> - `wrapExternalContent` always wraps when called (`wrapped: true`); the scan-first/wrap-when-flagged decision lives at the call sites, which keeps the module honest about what it did.
> - Reaction templates get `{{security.categories}}` in addition to `{{security.flagged}}`.

---

## File Map

| File | Change |
|---|---|
| `src/lib/server/content-safety.ts` | New — scanner + wrapper |
| `src/lib/server/__tests__/content-safety.test.ts` | New |
| `src/lib/server/mcp-resolver.ts` | Wrap flagged tool-result text |
| `src/lib/server/api-auth.ts` | `authorizeAdminOrScopedKey` returns the auth path; old helper reimplemented on top |
| `src/app/api/tasks/route.ts` | Scan key-created tasks; wrap flagged description; activity-log warning |
| `src/lib/server/reactions/executor.ts` | Scan payload once; `context.security`; log |
| `src/__tests__/api/activity.test.ts` etc. | Unaffected (same external behavior for session path) |

---

### Task 1: content-safety module (TDD)
- [x] Failing tests: flags for "ignore previous instructions", "disregard all prior", role-hijack ("you are now …", "\nHuman:"/"\nAssistant:" markers, `<system>`), exfiltration ("reveal/print your system prompt"), tool-abuse ("call the … tool with"); clean text → no flags; wrapper produces envelope with source/sender/trust attrs + banner; flags returned; `wrapped=true` only when wrapping applied; never throws on weird input.
- [x] Implement; tests green; commit.

### Task 2: MCP tool results
- [x] In `executeMcpTool`: scan joined text; if flagged → wrap (`source: mcp:<connection>/<tool>`, `trust: 'external'`) + `log.warn` with categories; return wrapped text. Unflagged results unchanged.
- [x] Unit test via the existing mcp-resolver test file's mock-fetch pattern.
- [x] Commit.

### Task 3: Scoped-key task creation
- [x] `authorizeAdminOrScopedKey(request, scope)` → `{ ok: true, via: 'session' | 'key', keyId? } | { ok: false, response }`; `requireAdminOrScopedKey` delegates.
- [x] In tasks POST: when `via === 'key'`, scan title+description+step instructions; if flagged → wrap description (`source: 'api:tasks'`, `trust: 'external'`) before storing + `activityLog` warning entry (action `content_safety_flagged`, level warn).
- [x] Endpoint test: flagged body via key → 200, stored description wrapped, activity entry written; same body via admin session → stored verbatim.
- [x] Commit.

### Task 4: Trigger payloads
- [x] In `executeReactions`: scan `JSON.stringify(eventPayload)` once; if flagged → `log.warn` + put `{ flagged: true, categories }` at `context.security` (available to reaction templates); unflagged → `context.security = { flagged: false }`.
- [x] Unit test in reaction-executor test file.
- [x] Commit.

### Task 5: Wrap-up
- [x] Full verification; checkboxes; deviations; commit.

## Out of scope
- `ProjectMcpConnection.trusted` flag (skip wrapping for marked-trusted tools) — add when someone hits a false positive; scan-always/wrap-when-flagged keeps the blast radius small meanwhile.
- Agent message wrapping — Epic 5 (the module is built for it: `bodySecurity` consumes `ContentSafetyResult`).
- UI warning badges — land with Epic 5's message UI where flags are first visible to users.
- Prompt-archive scanning — archive path is admin-configured local disk; revisit if remote sources appear.
