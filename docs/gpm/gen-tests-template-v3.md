# GEN_TESTS Template v3.0 — Test-Suite Augmentation Prompt

> **Depends on:** `core-specification-v1.md` (modes §1, P1, DoD §3, economics §5)
> **Replaces:** `gen-tests-template.md` (v1) and `enhanced-gen-tests-template.md` (v2.0).
> **Repositioned in v3:** GEN_TESTS is **no longer Phase 3 of GPM**. Under P1 (Tests Drive Design), behavioural tests are written *first*, inside the ZAP's Test Expectations — generating them after implementation is test-after and is retired. GEN_TESTS now has one job: **augmenting** an existing, TDD-built suite with the layers TDD doesn't naturally produce.

**Use this when:** a component's behavioural tests exist and pass, and you need to add integration, security, performance, mutation, or compliance test layers — typically entering DELIVERY integration work or HARDENING mode. Also for legacy code: characterisation tests before refactoring (pair with `legacy-code-strategist`).
**Do NOT use for:** a component's first tests (→ those live in the ZAP), or exploratory code in DISCOVERY (no test mandate there at all).

---

## 1. Mode Gate — which layers to request

| Layer | PROTOTYPE | DELIVERY | HARDENING |
|---|---|---|---|
| Characterisation (legacy only) | ✓ | ✓ | ✓ |
| Integration (DB, API, queue, cache) | core paths only | ✓ | ✓ |
| Contract tests (external integrations) | — | ✓ (DoD requires) | ✓ |
| Security (injection, authz, leakage) | only if auth/PII/money | ✓ | ✓ + pen-test scenarios |
| Performance | — | — | ✓ (sourced thresholds only) |
| Mutation testing | — | — | ✓ (Core Domain only) |
| Compliance (GDPR/audit-trail/etc.) | — | if regulated | ✓ |

Requesting all layers for every component is the v2.0 failure mode: the spec outweighs the value (Core §5.3). Pick rows from the table; delete the rest.

## 2. The Template

```markdown
# GEN_TESTS: [Component Name]
## Mode: [PROTOTYPE | DELIVERY | HARDENING]

## Component Under Test
[Name, file path (verified), public interface — paste the Contract
Snapshot (Core §4.1), not the implementation]

## Existing Coverage (do not duplicate)
[What the ZAP-born suite already covers: happy paths, error conditions,
edge cases. The generator must ADD layers, not restate these.]

## Layers Requested                       [from the Mode Gate table]
### Integration
[Which integrations, which failure scenarios: rollback, timeout,
unavailability, constraint violations, duplicate delivery]
### Security
[Which surfaces: injection points, authz boundaries, enumeration,
data leakage in errors/logs]
### Performance                            [HARDENING]
[Thresholds WITH sources (baseline/SLA/ADR) — or MEASURE FIRST tasks
to establish baselines. Unsourced thresholds are a validator failure.]
### Mutation                               [HARDENING, Core Domain]
[Target score with rationale; which business rules must survive mutation]

## Test Data
[Realistic sets, boundary sets, anonymised where PII is in scope (BB §3.8);
cleanup strategy]

## Mocking Boundary
[What is mocked (external services) vs real (the component, its domain
logic). Rule: never mock what you own within the unit under test.]

## Environment
[Framework and libraries — (verified) against the repo's actual stack,
not assumed defaults. Fresh DB / transaction isolation strategy.]

## Acceptance
[When is this augmentation done? e.g. "all integration failure paths
covered; suite still < 60 s" — a slow suite is a skipped suite.]
```

## 3. Quality Bar for Generated Tests

- Tests assert behaviour, not implementation; renaming a private method must not break them
- Specific assertions — no bare truthiness; error tests validate the exact error type/code
- Independent and deterministic; anything time- or random-dependent is injected
- Each test's name states the scenario and expected outcome
- Suite time budget declared; performance layers run in CI on a schedule, not per-commit, if they blow the budget

## 4. Anti-patterns (each retired for a reason)

- **Coverage worship:** ">95% line coverage" as a goal generates assertion-free tests. Coverage is a *smell detector* (untested area = risk), not a target. The Global DoD's 80 % on new logic stands; going beyond it needs a reason, not a template default.
- **The everything-menu:** v2.0's demand for GDPR + SOX + HIPAA + PCI tests per component. Compliance layers are per-system-and-regulation, scoped in HARDENING.
- **Test-after generation:** if the component has no tests and it isn't legacy code, the ZAP was executed wrong — fix the process, don't patch with GEN_TESTS.

---

## Provenance and maintenance
- Mode Gate table derives from Core §1 mode tables + Global DoD §3; re-verify against Core when either changes.
- v3.0 — 2026-07-02. Supersedes gen-tests-template v1 and enhanced-gen-tests-template v2.0. Position in the lifecycle changed: augmentation, not generation-after-the-fact.
