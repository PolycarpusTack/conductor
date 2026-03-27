# Conductor v0.2 Roadmap — Durable Execution, Human Review, Observability, Artifacts, Workflow Logic

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Transform Conductor from a task board with agents into a dependable agent-ops system by adding durable execution, richer human review, observability, artifact support, and workflow branching.

**Architecture:** Five independent workstreams, each producing shippable value. Ordered by impact: durable execution first (trust), human review second (oversight), observability third (visibility), artifacts fourth (utility), workflow logic fifth (power). Each workstream has its own plan document.

**Tech Stack:** Next.js 16, Prisma 7 (SQLite), Zod 4, React 19, Tailwind 4, shadcn/ui, Socket.IO

---

## Workstream Overview

| # | Workstream | Priority | Impact | Effort | Plan |
|---|-----------|----------|--------|--------|------|
| 1 | Durable Execution & Retry Control | Critical | Trust | Large | [Plan →](./2026-03-27-durable-execution.md) |
| 2 | Enhanced Human Review Gates | Critical | Oversight | Medium | [Plan →](./2026-03-27-human-review-gates.md) |
| 3 | Observability & Cost Tracking | High | Visibility | Medium | [Plan →](./2026-03-27-observability.md) |
| 4 | Artifacts (First-Class Outputs) | High | Utility | Medium | [Plan →](./2026-03-27-artifacts.md) |
| 5 | Workflow Branching & Logic | Medium | Power | Large | [Plan →](./2026-03-27-workflow-logic.md) |

## Execution Order

```
Workstream 1 (durable execution) ────► Workstream 3 (observability, depends on execution log)
Workstream 2 (human review) ──────────► standalone
Workstream 4 (artifacts) ─────────────► standalone
Workstream 5 (workflow logic) ────────► standalone (but benefits from 1 being done first)
```

**Recommended sprint order:**
1. Sprint 1: Workstream 1 (durable execution) + Workstream 2 (human review) in parallel
2. Sprint 2: Workstream 3 (observability) + Workstream 4 (artifacts) in parallel
3. Sprint 3: Workstream 5 (workflow logic)

## Future Layer (not planned yet)

These items from the feedback are deferred to v0.3+:
- Evaluation loops (golden tasks, regression suites, model comparisons)
- Agent specialization (prompt versioning, capability permissions, model routing)
- External integrations (GitHub, Slack, Linear, Jira)
- Multi-user RBAC (SSO, audit exports, project-scoped permissions)
- Scheduling & automation (recurring tasks, SLA timers, event-triggered chains)
- Shared memory/context (project knowledge bases, retrieval per agent team)
