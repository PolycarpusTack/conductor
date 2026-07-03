# Technical Debt Register

> Last updated: 2026-04-29
>
> ✅ = resolved | ⚠️ = active | 🔴 = blocking
>
> Items marked resolved are kept for historical context.

## Epic 1 — Prompt Archive Infrastructure (2026-04-29)

| ID | Description | File | Severity | Resolution |
|----|-------------|------|----------|------------|
| TD-001 ✅ | No caching — archive is re-read from disk on every request | src/lib/server/prompt-library.ts | Low | ✅ Resolved in Task 5.1 — 60s in-memory cache added to `listEntries()` |
| TD-002 | No recursive subfolder support (e.g. Anthropic/old/) | src/lib/server/prompt-library.ts | Low | Implement in a future iteration if needed |
| TD-003 | No file watcher — archive changes require app restart | src/lib/server/prompt-library.ts | Low | Acceptable for v1; add inotify/chokidar watch in v2 |

## Epic 2 — Archive Browser UI (2026-04-29)

| ID | Description | File | Severity | Resolution |
|----|-------------|------|----------|------------|
| TD-004 ✅ | No search/filter within the archive picker | prompt-archive-picker.tsx | Low | ✅ Resolved in Task 5.2 — client-side filter added to PromptArchivePicker |
| TD-005 | No keyboard navigation for the entry list (accessibility gap) | prompt-archive-picker.tsx | Medium | Add aria-* attributes and keyboard handler in a follow-up |
| TD-006 | Inline fetch logic in PromptArchivePicker could be extracted to a custom hook | prompt-archive-picker.tsx | Low | Extract to usePomptLibrary hook if component grows |

## Epic 3 — Agent Wizard UI Shell (2026-04-29)

| ID | Description | File | Severity | Resolution |
|----|-------------|------|----------|------------|
| TD-007 | `reviewForm` omitted from useEffect dependency array (stable ref — safe, but ESLint may warn) | agent-wizard-modal.tsx | Low | Add eslint-disable comment if lint baseline changes |
| TD-008 | Review form uses getValues() — user edits on review step are read at save time, not watched | agent-wizard-modal.tsx | Low | Switch to watch() if live validation is needed |
| TD-009 | Composing step (step 2) is a placeholder — wired in Epic 4 | agent-wizard-modal.tsx | High | Implement compose API call in Epic 4 |
| TD-010 | Runtimes API returned bare array not wrapped object — wizard adapted with Array.isArray guard | agent-wizard-modal.tsx | Low | Standardize API response shape in API review |

## GPM Plan — EPIC B (2026-07-03)

| ID | Description | File | Severity | Resolution |
|----|-------------|------|----------|------------|
| TD-015 | Workspace-less step retries every poll tick and writes one `daemon_dispatch_failed` activity entry per tick — no dedupe in daemon-dispatch | src/lib/server/daemon-dispatch.ts | Low | Dedupe or park the step after N identical failures; revisit in B-3/F-5 |
| TD-016 | commandTemplate tokens are validated at poll/spawn time, not when ProjectRuntime.config is written — bad templates surface late | src/app/api/daemon/steps/next/route.ts | Low | Add validation to the runtime-config settings API (EPIC C/D settings work) |
| TD-017 | Generic runner argv split is whitespace-based — no quoting for args containing spaces (documented in daemon README) | mini-services/conductor-daemon/runner.ts | Low | Add quoted-arg parsing if a real template ever needs it |
| TD-018 | ~~Adapter-reported cost dropped on the HTTP path~~ FIXED in B-7 (dispatch passes `result.cost`, estimate fallback via cost-estimator). REMAINING: daemon runs still create no StepExecution rows — cost/turns/session_id ride a JSON artifact, so B-7 budgets do not bind for DAEMON-mode agents | mini-services/conductor-daemon/evidence.ts | Medium | Wire daemon run results into StepExecution rows (daemon-execution EPIC) |
| TD-019 | Server persists step output at MAX_OUTPUT_CHARS=5000 (head-truncated) while the daemon ships a 64KB tail — full text survives only in artifacts/session events | src/app/api/daemon/steps/route.ts | Low | Revisit cap when the board renders long outputs |
| TD-020 | HTTP-path cost fallback uses blended per-token estimates (cost-estimator MODEL_COSTS) when the adapter reports tokens but no true cost — recorded spend is approximate for the Anthropic SDK path; unknown models record null (budget never binds on estimate alone for them) | src/lib/server/dispatch.ts, src/lib/server/cost-estimator.ts | Low | Have adapters compute true cost from per-direction token counts (B-7 follow-up / EPIC C-5 cost surfacing) |
| TD-021 | budget_lifted is only written on the first tick where the resumed project has a dispatchable step; project GET recomputes spend per request instead of caching | src/lib/server/budget.ts, src/app/api/projects/[id]/route.ts | Low | Acceptable — activity is audit-only and the aggregate is one indexed SUM; revisit with C-5 per-project cost chip |

## GPM Plan — EPIC E (2026-07-03)

| ID | Description | File | Severity | Resolution |
|----|-------------|------|----------|------------|
| TD-022 | `agent-memory-panel.tsx` load/delete error toasts use sonner, whose `<Toaster>` is never mounted (only `ui/toaster` + use-toast is) — those errors render nowhere | src/components/agent-memory-panel.tsx | Low | Migrate to use-toast or mount sonner; fold into a toast-system consolidation |
| TD-023 | Data layer is hand-rolled: reads/mutations patch a central `currentProject` object, reconciled by WS events. @tanstack/react-query is installed but unused (kept for a future E-2b). Deliberately DEFERRED — works today; migration is XL and partly duplicates WS reconciliation | src/hooks/*, src/app/_views/board-context.tsx | Low | Adopt react-query only if manual cache management becomes a demonstrated pain; else drop the dep in a later cleanup |

## Epic 4 — Wizard LLM Composition (2026-04-29)

| ID | Description | File | Severity | Resolution |
|----|-------------|------|----------|------------|
| TD-011 | Keyword search is naive — no stemming, no synonyms | wizard-composer.ts | Low | Upgrade to embeddings-based search using existing Skills infrastructure in v2 |
| TD-012 | COMPOSE_PROMPT is a hardcoded template string — not configurable | wizard-composer.ts | Low | Move to configurable prompt template in settings in v2 |
| TD-013 | No retry or timeout on LLM call in composeAgent | wizard-composer.ts | Low | Add timeout and retry with exponential backoff |
| TD-014 | composeAgent parses LLM JSON without schema validation — trusts LLM output shape | wizard-composer.ts | Medium | Add Zod parse on LLM response for safety |
