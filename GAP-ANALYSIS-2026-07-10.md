# Conductor — Gap Analysis (2026-07-10)

> Four-track review: (1) build/gate verification — actually executed; (2) core-flow code trace vs
> README; (3) integrations & data trace; (4) production-readiness (auth, secrets, SSRF, deploy,
> data safety, tests, resilience). Cross-checked against TECHNICAL_DEBT.md, ADR-0001..0006, and
> docs/gpm/state/. Line references are as of this date. Companion register: TECHNICAL_DEBT.md
> (items marked TD-xxx below are already tracked there; everything else is NEW).
>
> **Note:** working tree was dirty during review — 9 modified files on the auth surface
> (api-keys.ts, admin session/security routes, review-logic, steps route) + untracked
> docs/ops/performance-budget.md. Findings may already be partially addressed in-flight.

## Verdict in one paragraph

The source is in better shape than the gates suggest: 842/842 unit tests pass, lint and
project-code types are clean, auth is a well-designed three-plane system, and the HTTP-agent
path delivers what the README claims. What stands between this and "a working program" is
concentrated in four places: **(A)** a self-contradicting runtime story (a "Bun" project whose
server, doctor, and DB driver require Node on the default install); **(B)** the DAEMON execution
path, which skips roughly half the engine's bookkeeping — only 2 of its ~9 gaps were in the debt
register; **(C)** a deploy pipeline that has never produced a verified artifact; and **(D)** three
README features that are materially not there (agent-consumable skills, semantic skill search,
cross-project KPIs).

---

## Tier 0 — Broken today (fix first; hours, not days)

| # | Gap | Evidence | Fix shape |
|---|-----|----------|-----------|
| 0.1 | `bun run type-check` fails on a **corrupted generated file** — tsconfig includes `.next/dev/types/**` and a truncated `validator.ts` fails the gate with 0 real source errors | tsconfig.json:40; .next/dev/types/validator.ts:926,931 | Exclude `.next/dev` from tsconfig (or clear it in the script preamble) |
| 0.2 | `bun run doctor` **can never pass on the default install** — it runs under Bun, which cannot load better-sqlite3 (bun#4290); doctor.ts:667-669 even documents this against itself | scripts/doctor.ts:98; package.json:15 | Run doctor under Node (`node --experimental-strip-types` or a compiled entry), or auto-detect and re-exec |
| 0.3 | **The app server itself doesn't boot under Bun + SQLite** (instrumentation Prisma call, server.log ~5×) — README's "Bun 1.3+" framing vs phase-summary-epic-F: "runs under Node not Bun" | server.log; docs/gpm/state/phase-summaries/phase-summary-epic-F.md:25 | Decide the story: Node-first (update README/scripts) or Bun+Postgres. Make `bun run dev` do the right thing on the default path |
| 0.4 | **No production build has ever succeeded** — no BUILD_ID, no .next/static; the 2026-07-05 standalone dir is a 0-file skeleton | .next/ state | Run `next build` under Node with .next/dev cleared; make it a CI gate |

## Tier 1 — Blocks production

### A. The daemon path is a second-class citizen (the biggest theme)
The HTTP dispatch path is solid (lease-first, atomic attempts, backoff, fallback, dead-letter,
budget gate). The DAEMON path skips most of it. Known: **TD-018b** (no StepExecution rows → costs,
analytics, and **budget enforcement never bind** for daemon agents), **TD-025** (terminal failures
never dead-letter). **New, same class — not in the register:**

| # | Gap | Evidence | Severity |
|---|-----|----------|----------|
| 1.1 | **No `resolvePrompt` on the daemon path** — `{{memory.recent}}`, `{{task.title}}` etc. ship to the CLI as literal unresolved tokens | api/daemon/steps/next/route.ts:170-176; runner.ts:162-188; resolve-prompt.ts never called | blocks production |
| 1.2 | **No previous-step output in the daemon payload** — a mid-chain daemon step loses all upstream context | dispatch.ts:218-243 (HTTP builds it) vs payload snapshot | blocks production |
| 1.3 | **Review-rejection feedback never reaches daemon agents** — a rewound step re-runs the identical prompt | dispatch.ts:296-300 vs steps/next payload | blocks production |
| 1.4 | **Retries effectively absent**: server trusts daemon-supplied `willRetry`, no server-side maxRetries/backoff, and the reference daemon always sends `willRetry:false` → every daemon failure is single-attempt terminal | api/daemon/steps/route.ts:148-162; conductor-daemon/index.ts:214-221 | blocks production |
| 1.5 | No `notifyDeadLetter` on daemon terminal failure — invisible in panel **and** notification bell (extends TD-025) | dispatch.ts:596-602 vs daemon route | blocks production |
| 1.6 | Daemon agents get **no MCP tools at all** | zero MCP refs in daemon-dispatch.ts | blocks production (for MCP users) |
| 1.7 | No fallback-agent escalation; no `agent.maxConcurrent` enforcement; `startedAt` never stamped (durations null); no projectMode instructions/outputFormat in payload | dispatch.ts:537-558, 204-215, 404-409 vs daemon path | polish (bundle with above) |

**Fix shape:** one EPIC — "daemon path parity" — routing daemon completion/failure through the same
`dispatch.ts` bookkeeping (StepExecution, dead-letter, notify, retry policy) and enriching the
Execution Payload (resolved prompt, previousOutput, rejectionNote, mode instructions). This is
the highest-value block in the whole list: the daemon tracer bullet (EPIC A) was never brought up
to the engine's standard.

### B. Deploy has never been proven
| # | Gap | Evidence |
|---|-----|----------|
| 1.8 | **TD-024**: Docker images never built; untested links: Debian better-sqlite3 compile, standalone tracing, in-container db push | TECHNICAL_DEBT.md:14 |
| 1.9 | **`--accept-data-loss` runs on every container boot** with no migration history — a schema divergence after an image upgrade silently drops columns/data | docker-entrypoint.sh:21 |
| 1.10 | **No Prisma migrations at all** (db push only); Postgres deploys drive a sqlite-provider schema; pgvector column exists only via hand-run init-pgvector.sql — skipping it silently degrades semantic search | prisma/ (no migrations dir); ADR-0004 |
| 1.11 | The production artifact is **never e2e-tested** (Playwright runs against `bun run dev`; standalone can't start on Windows/NTFS) | playwright.config.ts:6-9; INSTALL.md:16 |
| 1.12 | SQLite runs with **no WAL, no busy_timeout** — second-process access (scripts/doctor against a live server) hits SQLITE_BUSY; INSTALL.md documents WAL files that never exist | no pragma anywhere; INSTALL.md:250-269 |

**Fix shape:** a Linux/Docker host session: build images (1.8), adopt `prisma migrate` + remove
`--accept-data-loss` (1.9/1.10), add WAL+busy_timeout pragmas (1.12), run e2e against the built
artifact (1.11).

### C. README features that are materially missing
| # | Gap | Evidence |
|---|-----|----------|
| 1.13 | **Skills: agents can't consume them.** No skill reference in dispatch/resolve-prompt; /api/skills is admin-session-only; README claims "reusable knowledge agents can pull in" | dispatch.ts; resolve-prompt.ts:24-27 |
| 1.14 | **Semantic skill search returns 0 rows on the premium config** — nothing ever embeds skills (only memories are embedded), so on Postgres+pgvector the `WHERE embedding IS NOT NULL` query is always empty; SQLite substring fallback is the *working* path. Help docs claim "embedded on save" — false | skills/search/route.ts:79,91; embeddings only in memory.ts; help-content.tsx:1655 |
| 1.15 | Skill "versioning" is schema-only (version always 1; updateSkillSchema defined, never used); CRUD is create+list only (no get/update/delete) | schema.prisma:671; contracts.ts:375; skills-page.tsx:112 |
| 1.16 | **"Cross-project KPIs" don't exist** — analytics is per-project only; help docs promise cross-project cycle time / review-wait / rejection rate / cost-per-task, none computed | observability-dashboard.tsx:79; help-content.tsx:2216-2227 |
| 1.17 | **MCP client is not spec-MCP**: raw JSON-RPC-over-HTTP only — no initialize handshake, no session headers, no SSE/streamable-HTTP, no stdio, **no auth** (the `config` column is never read); UI "Type" dropdown is cosmetic | mcp-resolver.ts:110-118,199-211; schema.prisma:214 |
| 1.18 | Reactions have **no durable delivery**: inline fire-and-forget in the web process, no queue/retry; process death = lost deliveries; chain stops at first failing reaction | evaluator.ts:52; executor.ts:116 |

## Tier 2 — Security hardening (none block basic use; several matter before multi-user production)

| # | Gap | Evidence |
|---|-----|----------|
| 2.1 | **Members can mint/revoke scoped API keys and rotate agent keys** (`requireAdminSession`, not `requireRole('admin')`) — key issuance survives user deactivation | admin/api-keys/route.ts:20,28,51; agents/[id]/key |
| 2.2 | **CSRF**: 32 cookie-auth mutating routes rely on SameSite=Lax alone (no assertSameOrigin) — projects/agents/triggers/reactions/runtimes/MCP/modes CRUD, seed, workspaces | route sweep |
| 2.3 | MCP endpoint fetches skip the SSRF guard (`isSafeExternalUrl`) that the webhook adapter at the same trust level applies | mcp-resolver.ts:110,199 vs adapters/webhook.ts:22 |
| 2.4 | Legacy plaintext `Agent.apiKey` fallback still live (auto-migrate-on-use exists; purge script never run as a gate) | api-keys.ts:100-131 |
| 2.5 | `/api/auth/reset/request` has no rate limit → email-flood vector on SMTP-configured installs | reset/request route |
| 2.6 | Legacy **unbound** scoped keys still work instance-wide (deprecation warn only) | api-auth.ts:77-88 |
| 2.7 | Session-signing secret defaults to the admin password itself | admin-session.ts:31-33 |
| 2.8 | Compose Postgres profile: hardcoded `conductor_dev` password with 5432 published to host | docker-compose.yml:66-70 |
| 2.9 | WS client gives up permanently after 5 reconnect attempts and never resyncs missed events (hand-patched cache, TD-023) | useWebSocket.ts:70-88 |

## Tier 3 — Polish & doc-truth (cheap; do opportunistically)

- **Dead/vapor claims:** README "live cursors" (board-ws relays them; no client emits/renders) · runtime dashboard "step queue" view (help docs promise queue depth/throughput; nothing in code) · runtime live daemon log frozen (WS connects only on board view — useWebSocket.ts:40) · unconsumed WS events (session-output, budget-exceeded, user-joined…).
- **.env.example omissions** (consumed but undocumented): ANTHROPIC_API_KEY, SMTP_*, NOTIFY_EMAIL_TO/FROM, EMBEDDING_MODEL, OTEL_EXPORTER_OTLP_ENDPOINT. Silent no-ops without config: embeddings, Sentry poll, notification email, unreachable MCP.
- **Wizard prerequisites:** dead without PROMPT_LIBRARY_PATH (503) and an LLM key (generic 500) — README lists it as a headline feature with no caveat; surface the real error.
- **Export is deliberately lossy** (MCP, triggers/reactions, templates/recurring, skills, memories, activity excluded) — README "back up a project" oversells; document the bundle scope.
- **Docs bugs:** INSTALL.md describes WAL files that never exist; help-content.tsx overclaims (skills "embedded on save", cross-project metrics, queue metrics); stale TODO notification-center.tsx:9.
- **Test debt:** e2e = 4 specs (no multi-user, keys, reactions, export/import, dnd, WS behavior); TD-014b mock load-order fragility (130 mock.module calls, alphabetical coupling); 4 exhaustive-deps lint warnings.
- Known ⚪ TD items: TD-015/016/017/019/020/021/022/023, TD-002/003/005/011/012/013.

## What's already solid (for fairness and to protect it)

Board/chains/review-gates/agent-HTTP-API/CLI (works as claimed, no orphan states) · three-plane
auth with hashed keys and clean route coverage (no unauthenticated mutations found) · secrets
hygiene (env-name indirection, verified secret-free export, nothing tracked) · SSRF guard +
content-safety envelope + login rate limiting · reapers/leases/scheduler-lock · 842 passing unit
tests with real breadth on the risk core · honest ADRs and a current debt register.

## Suggested sequencing (EPIC-shaped)

1. **EPIC G0 "green gates"** (Tier 0) — a day: tsconfig exclude, doctor-under-Node, runtime story decided and documented, first verified `next build` in CI.
2. **EPIC G1 "daemon parity"** (Tier 1A) — the big one; makes the headline execution path production-grade. Extends TD-018b/TD-025 into the full parity list above.
3. **EPIC G2 "proven deploy"** (Tier 1B) — needs a Docker host; migrations adopted, `--accept-data-loss` removed, WAL pragmas, e2e against the artifact.
4. **EPIC G3 "truth in features"** (Tier 1C) — either implement (skills embed-on-save + agent consumption path + MCP auth/handshake + cross-project rollup) or de-claim in README/help. Skills consumption is also the precondition for seeding the prompt-engineering kit as skills content.
5. **Tier 2 hardening** folded into the security re-review EPIC G already plans; Tier 3 opportunistically.
