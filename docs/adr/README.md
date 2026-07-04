# Architecture Decision Records

This directory records the significant architecture decisions for Conductor
(AgentBoard). Each ADR captures one decision, the context that forced it, and
the consequences we accepted.

These ADRs were **backfilled** (EPIC F, story F-3): the brownfield evaluation
found ADR coverage ABSENT, so the decisions below were already IMPLEMENTED when
recorded. Every ADR was verified against the code as written and cites the
files that embody the decision. They document reality, not aspiration.

## Template

New ADRs use a lightweight template: **Title, Status, Context, Decision,
Consequences, Date**. Copy an existing file. Status is one of `Proposed`,
`Accepted`, `Superseded by ADR-XXXX`, `Deprecated`. Number sequentially.

## Index

| ADR | Title | Status |
| --- | --- | --- |
| [ADR-0001](ADR-0001-runner-process-model.md) | Runner process model | Accepted |
| [ADR-0002](ADR-0002-leasing-and-idempotency-model.md) | Leasing & idempotency model (steps AND claims) | Accepted |
| [ADR-0003](ADR-0003-budget-enforcement-point.md) | Budget enforcement point | Accepted |
| [ADR-0004](ADR-0004-sqlite-postgres-pgvector-duality.md) | SQLite / Postgres / pgvector duality | Accepted |
| [ADR-0005](ADR-0005-three-plane-auth.md) | Three-plane authentication | Accepted |
| [ADR-0006](ADR-0006-poll-based-single-instance-dispatch.md) | Poll-based single-instance dispatch | Accepted |
</content>
</invoke>
