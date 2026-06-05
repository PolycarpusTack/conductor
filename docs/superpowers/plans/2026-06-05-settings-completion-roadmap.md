# Settings Completion — Roadmap & Development Plan

> Born from the 2026-06-05 settings review: the in-app help described a richer settings
> surface than exists. Every gap below was either (a) promoted to this roadmap as a planned
> feature, or (b) corrected in the help where the documentation was simply wrong about
> current behavior. The help's Settings tour now describes reality and marks roadmap items
> explicitly.

**Status:** Planned · prioritized · not started (except items marked ✅ shipped in the review)
**Convention:** each epic gets a full plan doc (verified against the codebase at start time) when picked up.

---

## Drift inventory → disposition

| Help claimed | Reality (v0.2.0) | Disposition |
|---|---|---|
| General: edit name/description | Read-only fields | ✅ **Shipped with this roadmap** — editable, wired to `PUT /api/projects/[id]` |
| General: default mode, default chain | Don't exist | **Epic S1** |
| General: retention controls (artifacts/steps) | Only activity-log retention exists (Activity tab) | **Epic S1** |
| General: delete project (type-to-confirm) | No UI (API exists) | **Epic S1** |
| Agents row: rotate key / duplicate | Activity, edit, delete only (rotate lives on API tab) | **Epic S2** (duplicate); rotate stays on API tab — help corrected |
| API: admin session timeout setting | Fixed 12h TTL in code | **Epic S2** |
| Security tab: change admin password | Env var only (`AGENTBOARD_ADMIN_PASSWORD`) | **Epic S2** |
| Activity: soft-delete + resurrect tasks | Tasks are hard-deleted | **Epic S3** |
| Activity: date-range filter | Export API supports from/to; UI doesn't | **Epic S3** (small) |
| Modes: max attempts per mode | Retries live on steps (`maxRetries`), not modes | **Epic S4** |
| Modes: per-mode tool allowlist UI | Mode filtering exists in `resolveMcpTools`; no UI | **Epic S4** |
| Modes: output format hint | Doesn't exist | **Epic S4** (lowest) |
| Runtimes: paste key, encrypted at rest, test call, usage stats | Keys are **env-var references** (better!); discovery exists; no test call/usage | Help corrected (env vars); test call → **Epic S5**; per-runtime usage → **Epic S5** |
| MCP: discover tools, per-tool allowlist/disable, usage stats | Endpoint CRUD only; `scopes` column exists unused in UI | **Epic S5** |
| Templates: task templates, versioning, share-to-workspace, archive | Chain templates CRUD only | **Epic S6** |
| Automation: escalation/archive/retry-default rules, dry run | Scheduler mode + interval + window only | **Epic S7** |

---

## Epics (priority order)

### Epic S1 — Project lifecycle settings ✅ SHIPPED 2026-06-05
See `2026-06-05-settings-s1-project-lifecycle.md` for the executed plan.

*(original scope below)*
General tab grows up: default mode + default chain for new tasks (consumed by task
creation), artifact/step retention with background purge (activity-log retention as the
pattern), and delete-project with type-the-name confirmation. *Touches:* settings-dialog
General tab, project schema (defaults), task-create route, a purge job, `DELETE
/api/projects/[id]` confirmation flow.

### Epic S2 — Admin & security settings ✅ SHIPPED 2026-06-05 (layered env+DB credentials)
A real Security tab: change admin password from the UI (writes hash, invalidates sessions),
configurable session TTL, and agent duplicate action. *Depends on:* deciding to move the
admin password from env to DB (or layering: env var bootstraps, DB overrides). Design
needed before code — this changes the auth bootstrap story.

### Epic S3 — Soft-delete & activity ergonomics ✅ SHIPPED 2026-06-05
Task soft-delete (`deletedAt`) with a 30-day resurrect window surfaced in the Activity tab,
plus a date-range filter in the activity UI (API already supports it). The help originally
*claimed* soft-delete existed; users will expect it.

### Epic S4 — Mode policy depth ✅ SHIPPED 2026-06-05
Per-mode max attempts (feeding step defaults in both task-create and step-add routes),
per-mode tool allowlist editor (exact + `conn__*` prefix patterns, layered after the
`resolveMcpTools` mode heuristics), output-format hint appended to mode instructions.
Makes modes the policy object the help always described.

### Epic S5 — Runtime & MCP operations ✅ SHIPPED 2026-06-05 (per-tool usage stats deferred)
Per-runtime test call (the `/api/admin/runtimes/[id]/health` ping from v0.0.6 — just needs
a button!), per-runtime usage rollups from execution logs, MCP tool discovery UI
(`tools/list` against the endpoint), and per-tool enable/disable persisted to the unused
`scopes` column.

### Epic S6 — Task templates ✅ SHIPPED 2026-06-05
The form-side counterpart to chain templates: saved task defaults (title pattern with
`{date}` expansion, description, priority, tag, notes, attached chain) with CRUD in the
Templates tab and a "Start from template" picker in the task-create dialog.
Versioning/share-to-workspace/archive remain stretch goals (not shipped).

### Epic S7 — Automation rules engine — 📐 DESIGN COMPLETE 2026-06-05
Beyond the scheduler: auto-assign by tag/priority/title, auto-archive DONE after N days,
review-gate escalation notifications (compose with Triggers/Reactions rather than
duplicating them), retry-policy defaults. Design doc:
`2026-06-05-settings-s7-automation-rules-design.md` — rules as *internal reaction
types* on the existing Trigger/Reaction pipeline, time-based rules as synthetic
events from a scheduler sweep, `archivedAt` (non-purging) for archive, hard
no-cascade rail. Three shippable phases; per-mode retry defaults already landed in S4.

## Quick wins shipped with this roadmap (2026-06-05)
- Editable project name/description on the General tab (wired to the existing PUT).
- `/api/admin/runtimes/[id]/health` noted in S5 — the backend half already exists.
- Help Settings tour rewritten to match reality, with explicit "🛣 On the roadmap" markers
  pointing at the epics above.
- Label/input `htmlFor` association on the General tab (a11y pattern for other panels to copy).
