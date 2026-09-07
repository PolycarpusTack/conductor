# Assumptions Ledger — Conductor

> July ledger retained for history. Current September assumptions and unresolved
> decisions are in [the working program, section 5](working-program-2026-09-07.md#5-decisions-and-assumptions-ledger).
> Old ASSUMED entries are not implicitly promoted to accepted requirements.

Updated: 2026-07-03. High-impact items flagged ⚑. Mark (verified) when confirmed with the owner.

| # | Assumption | Impact if wrong | Status |
|---|---|---|---|
| A1 ⚑ | Target deployment is **single-operator self-host, single instance** (no HA, no multi-tenant SaaS) — EPIC scoping and the scoped-key fix depth depend on this | Multi-tenant would promote per-project ACLs and HA-safe leasing from MEDIUM to BLOCKING | ASSUMED |
| A2 ⚑ | "A+ state" = all seven evaluation dimensions ≥ 8/10 **and** the daemon mode really executing work — not marketing/site polish | Plan prioritisation shifts | ASSUMED |
| A3 ⚑ | Daemon CLI target is **Claude Code headless** (`claude -p` style) first; other CLIs later via commandTemplate | Tracer bullet design changes | ASSUMED |
| A4 | The unused deps (TanStack Query, dnd-kit, next-intl, zustand) represent **intent**, so EPIC E adopts TanStack Query + dnd-kit and REMOVES next-intl + zustand (i18n not needed for v1) | Swap adopt/remove decisions in E-1/E-2 | ASSUMED |
| A5 | Model B (external claim API) is worth keeping and should be unified onto lease semantics, not deleted | If deprecated instead: B-2 shrinks to a removal task | ASSUMED |
| A6 | SQLite stays the default; Postgres remains optional (no forced migration) | EPIC F duality work becomes a migration project | ASSUMED |
| A7 | Solo developer + AI agents remains the team shape; GPM roles (Architect/Stakeholder/Reviewer) all map to the owner | Ceremony calibration | (verified — repo history) |
| A8 | No real users yet → no backward-compat constraints on API shapes changed by the plan (e.g. scoped-key scoping) | Breaking-change protocol needed | ASSUMED |
| A9 | Windows is the dev host, Linux/WSL the deploy host | Affects F-2 packaging targets | (verified — repo + scripts) |
