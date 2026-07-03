# ZAP Template v3.0 — Zero-Assumption Prompt Authoring Guide

> **Depends on:** `core-specification-v1.md` (modes §1, principles §2, DoD §3, snapshots §4.1, economics §5)
> **Canonical skeleton:** GPM v2.1 §4 Phase 2. This document is the extended authoring guide for that skeleton.
> **Replaces:** `zap-template.md` (v1) and `enhanced-zap-template.md` (v2.0). One template, scaled by execution mode — the "Enhanced" fork is retired.

**Use this when:** authoring a ZAP for a single component — new behaviour (FEATURE) or restructuring (REFACTORING).
**Do NOT use for:** connecting validated components (→ CIP template), restructuring ahead of a feature (→ PREP, GPM §4), exploration (→ SPIKE), or expanding an existing test suite (→ GEN_TESTS v3).

---

## 1. The Template

Sections marked **[always]** apply in every mode. Sections marked **[DELIVERY+]** or **[HARDENING]** are added only in those modes — including them in DISCOVERY/PROTOTYPE work fails the anti-bureaucracy test (Core §5.3).

```markdown
# ZAP: [Component Name]
## Mode: [DISCOVERY | PROTOTYPE | DELIVERY | HARDENING]     [always]
## Hat: [FEATURE | REFACTORING]                              [always]

## Context                                                   [always]
[Business domain, why this component exists, what process it feeds.
One paragraph. This becomes the seed of the Integration Note.]

## Domain Context                                            [always]
[Glossary terms this component uses — exact terms, no synonyms (P3)]

## Requirements                                              [always]
[Numbered, exhaustive. "Exhaustive" beats "brief" — under-specified
ZAPs are the #1 cause of rework (GPM §5 escalation triggers).]

## Input/Output Contract                                     [always]
[Typed interfaces. Mark every referenced type/interface/table:
  (verified) — exists in the repo, checked at authoring time
  (NEW)      — this task creates it
  (ASSUMED)  — unverified; add to Assumptions Ledger with a check step
Unmarked references are a validator failure in DELIVERY+ (P11).]

## Business Rules                                            [always]
[Numbered if/then rules with concrete values: "10% student discount,
max €50, requires .edu verification" — not "handle discounts".]

## Test Expectations                                         [always — this is where TDD starts]
  Happy Path: [specific scenarios]
  Error Conditions: [each failure mode and the exact expected response]
  Edge Cases: [boundaries, empty inputs, unicode, precision]
  Performance: [only with a sourced number — see Numbers Rule below]

## Error Handling                                            [always]
[Every error condition → defined response. Reference the cross-cutting
error-format ADR rather than restating it (P6).]

## Constraints                                               [always]
[Stack, versions, libraries, patterns to follow, patterns to avoid]

## Dependencies                                              [always]
[Contract Snapshots of upstream components (Core §4.1) — never full source]

## Abstraction Check                                         [PROTOTYPE+]
[Patterns from previous components to reuse. Rule of Three (Core §5.5).]

## Security Considerations                                   [DELIVERY+]
[Input validation, authz, PII handling, injection surfaces, audit events.
In PROTOTYPE, include only if the component touches auth/PII/money.]

## Observability                                             [DELIVERY+]
[Structured log events, metrics, trace points — per the observability ADR]

## Compliance                                                [HARDENING, or DELIVERY when regulated]
[Only the regulations that actually apply to THIS component, with the
specific control each one requires. No boilerplate GDPR/SOX/HIPAA walls.]

## Performance Verification                                  [HARDENING]
[Numeric thresholds with sources, and the test that proves each one]
```

---

## 2. The Numbers Rule

Every numeric target in a ZAP (latency, throughput, memory, coverage beyond the Global DoD) must cite its source: a baseline measurement, a contractual SLA, or an ADR. If no source exists, write `MEASURE FIRST: <how to establish the baseline>` instead of inventing a number. An honest gap beats a plausible figure — invented thresholds become invented SLOs become HARDENING-mode verification of nothing.

## 3. Quality Checklist (run before submitting the ZAP)

- [ ] Mode and Hat declared; sections match the mode (no HARDENING ceremony on PROTOTYPE work)
- [ ] Every requirement testable; every business rule has concrete values
- [ ] Every interface/type/table marked (verified)/(NEW)/(ASSUMED)
- [ ] Every error condition has a defined response
- [ ] Glossary terms used exactly — zero synonyms
- [ ] Every number sourced or marked MEASURE FIRST
- [ ] Anti-bureaucracy test: the ZAP is not longer than the code it will produce (Core §5.3)
- [ ] GIGO check: specific, complete, unambiguous, testable

## 4. Worked Example (DELIVERY mode, abridged)

```markdown
# ZAP: Login Function
## Mode: DELIVERY | ## Hat: FEATURE

## Context
Authenticates users and issues session tokens. Feeds every protected
route; failure here is a full outage of the authenticated product.

## Domain Context
Account, Credential, Session, Lockout (per glossary — not "user login state")

## Requirements
1. Validate identifier (email or username) + password against Account store
2. Issue JWT on success; track attempts per IP and per Account
3. Lock Account after 5 consecutive failures within 15 min
4. Log every attempt as a structured audit event

## Input/Output Contract
LoginRequest { identifier: string, password: string, ipAddress: string } (NEW)
LoginResponse { success, token?, expiresAt?, errorCode? } (NEW)
AccountRepository.findByIdentifier() (verified — src/repos/account.ts)
RateLimitService.check() (ASSUMED — Redis-backed limiter; verify it exposes
  per-key windows before implementation → Assumptions Ledger AL-1)

## Business Rules
1. Identical error for "not found" and "wrong password" (enumeration defence)
2. Email matching case-insensitive; username case-sensitive
3. Lockout escalates: 15 min → 1 h → 24 h
4. bcrypt ≥ 12 rounds, constant-time comparison

## Test Expectations
Happy: valid email login; valid username login; token claims correct
Errors: bad password → generic error; 5th failure → lockout response;
  locked account → remaining-time message; DB down → 503, no stack leak
Edge: empty identifier; 1MB password; unicode identifier
Performance: MEASURE FIRST — no auth baseline exists; establish p95
  under 100 concurrent logins before setting a threshold

## Error Handling
Per ADR-4 (error envelope). Never distinct messages per Business Rule 1.

## Security Considerations
Constant-time comparison; hash IPs in logs; rate limit per IP AND per
Account; audit events: attempt, lockout, unlock.
```

Note what the DELIVERY example *omits*: no Kubernetes manifests, no compliance matrix, no mutation-testing mandate. Those belong to CIP-HARDENING and GEN_TESTS when the mode calls for them.

## 5. Customisation Axes (from v1, retained)

- **Web APIs:** add status-code map, pagination, versioning to the I/O contract
- **Data pipelines:** add validation/transformation rules, retry semantics, idempotency keys (BB §3.7)
- **UI components:** add accessibility criteria and the design-system tokens to Constraints
- **Junior/Sonnet-class executors:** be more concrete everywhere; ambiguity that a senior resolves correctly, a junior resolves plausibly

---

## Provenance and maintenance
- Skeleton must stay aligned with GPM v2.1 §4 Phase 2 — if that changes, change this. One home per fact: principles live in Core, this file only *applies* them.
- Marking scheme (verified/NEW/ASSUMED) implements Core P11; if P11's wording changes, re-verify §1 and §3 here.
- v3.0 — 2026-07-02. Supersedes zap-template v1 and enhanced-zap-template v2.0.
