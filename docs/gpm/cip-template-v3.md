# CIP Template v3.0 — Contextual Implementation Prompt Authoring Guide

> **Depends on:** `core-specification-v1.md` (modes §1, snapshots §4.1, DoD §3)
> **Canonical skeleton:** GPM v2.1 §4 Phase 3. This document is the extended authoring guide for that skeleton.
> **Replaces:** `cip-template.md` (v1, 38 KB) and `enhanced-cip-template.md` (v2.0). The v1 worked example — a full microservice with Kafka topology, K8s manifests, and infra sizing — was a solution design wearing a prompt's clothing; that material belongs in a Solution Design (BB §11), not a CIP.

**Use this when:** connecting **validated** components into an integrated flow. Every component a CIP wires must have an accepted Contract Snapshot.
**Do NOT use for:** building a component (→ ZAP), restructuring before integration (→ PREP — issue it first, per GPM §4 Phase 3), or infra/platform design (→ Solution Design).

---

## 1. The Template

```markdown
# CIP: [Integration Name]
## Mode: [PROTOTYPE | DELIVERY | HARDENING]                  [always]
## Hat: FEATURE                                              [always]

## Integration Context                                       [always]
[What is being connected and why — the business flow this enables.
One paragraph; seeds the Integration Note.]

## Component Contracts                                       [always]
[Contract Snapshots of every component being wired — pasted, not linked.
Run the Pull Gate first (P8): if any snapshot is stale, STOP and update
before authoring the CIP. Mark anything not snapshot-backed (ASSUMED).]

## Dependency Wiring                                         [always]
[Instantiation, injection, configuration. Which layer owns construction.]

## API Surface                                               [always]
[Endpoints/handlers this integration exposes; request→response flow
through the wired components; middleware order where it matters.]

## Integration Test Expectations                             [always]
[End-to-end scenarios INCLUDING failure paths: upstream down, timeout,
partial completion, duplicate delivery. Happy-path-only integration
tests are how distributed bugs ship.]

## Configuration                                             [always]
[Env vars / settings keys — (verified) against the config catalog or
(NEW). Defaults stated. No secrets in the prompt, ever.]

## Feature Flags                                             [DELIVERY+]
[Flag name + default for user-facing changes (Global DoD). How the flow
behaves flag-off.]

## Rollback Plan                                             [DELIVERY+]
[How to disable this integration without breaking the components it
wires. If the answer is "can't", the CIP is not ready.]

## Observability                                             [DELIVERY+]
[Log events with correlation IDs across the flow; golden-signal metrics;
trace spans; health checks. Per the observability ADR.]

## Idempotency & Delivery Semantics                          [DELIVERY+ where writes cross boundaries]
[Idempotency keys, conflict strategy, at-least-once vs exactly-once
assumptions — stated, not implied (BB §3.7).]
```

## 2. HARDENING Annex

Added to a CIP only in HARDENING mode, or when a DELIVERY integration crosses a trust or SLA boundary. This is where v2.0's production checklist survives — as a *menu scoped per integration*, not a mandate:

- **Resilience:** circuit breakers, retry with backoff (and where retry is forbidden — payments), bulkheads, dead-letter handling, cache-unavailable fallback
- **Security hardening:** authn/z at the new surface, security headers, rate limiting, input validation at the boundary (never trust the upstream component's validation)
- **Performance:** connection pooling, pagination, compression — each with a sourced threshold or `MEASURE FIRST`
- **Operational readiness:** runbook entry (symptoms → checks → rollback), alert thresholds, SLO wiring
- **Compliance:** only the controls this flow actually triggers, named specifically

## 3. Quality Checklist

- [ ] Every wired component has a current Contract Snapshot; Pull Gate passed
- [ ] Failure-path integration tests specified, not just happy path
- [ ] Config keys marked (verified)/(NEW); no secrets present
- [ ] Rollback plan exists and doesn't require redeploying the components
- [ ] Mode-appropriate: no HARDENING annex on PROTOTYPE wiring
- [ ] Anti-bureaucracy test passes (Core §5.3)

## 4. Compact Example (DELIVERY)

```markdown
# CIP: Checkout Flow — wire OrderCalculation into OrderController
## Mode: DELIVERY | ## Hat: FEATURE

## Integration Context
Connects validated OrderCalculationService into the checkout endpoint so
totals come from domain logic instead of the client-supplied figure.

## Component Contracts
CONTRACT SNAPSHOT: OrderCalculationService v2 [pasted]
CONTRACT SNAPSHOT: InventoryService v1 [pasted]
PaymentService.processPayment (ASSUMED v3 — pull gate flagged a pending
signature change; verify before execution → AL-1)

## Dependency Wiring
Constructor injection via existing container config (verified —
src/config/container.ts); no new singletons.

## API Surface
POST /api/orders: validate → inventory check → calculate → reserve →
pay → confirm. Reservation released on payment failure.

## Integration Test Expectations
Happy: order created, totals match calculation, reservation confirmed.
Failure: payment declined → reservation released, order not persisted;
inventory service timeout → 503, nothing reserved; duplicate submit with
same idempotency key → same order returned, no double charge.

## Configuration
ORDER_RESERVATION_TTL_S (NEW, default 300)
PAYMENT_TIMEOUT_MS (verified — config/payments.ts, 30000)

## Feature Flags
checkout_domain_totals — default false; flag-off keeps legacy total path.

## Rollback Plan
Flip flag off. No schema change in this CIP; components untouched.

## Idempotency
Client-supplied Idempotency-Key header; conflict strategy: return
original order (BB §3.7).
```

---

## Provenance and maintenance
- Skeleton must stay aligned with GPM v2.1 §4 Phase 3; one home per fact — resilience/ops principles live in Core and BB, this file applies them.
- v3.0 — 2026-07-02. Supersedes cip-template v1 and enhanced-cip-template v2.0.
