# GPM Onboarding v3.0 — The 30-Minute Team Workshop

> **Depends on:** `core-specification-v1.md`, `gpm-v2.1.md`
> **Replaces:** `gpm-quickstart.md` and `gpm-enhanced-quickstart.md`. The workshop format survives from v1 because it works; the fictional CLI tooling, unsourced success metrics, and mandatory-quality-gates theatre do not.

**Use this when:** onboarding a team (human or mixed human/agent) to GPM for the first time, or re-baselining a team that has drifted.
**Do NOT use for:** reference during execution (→ gpm-v2.1 + Core Spec) or prompt authoring (→ the v3 templates).

---

## Pre-Session (10 minutes, day before)

**Attendees:** 1 Architect, 1–3 Stakeholders (PM/BA/domain expert), 1–2 Developers or agent operators, 1 Reviewer. Roles per GPM v2.1 §2.

**Materials:** access to your AI assistant; a shared space for prompts and outputs; one real, *small* feature from your backlog; the Core Spec §1 mode table printed or on screen.

**Facilitator prep:** read Core §1 (modes) and §5.3 (anti-bureaucracy test). You will lean on both.

## The Workshop

### Minutes 0–5 — What GPM is
One line: **humans architect, AI executes, humans validate — with rigor scaled to the work's maturity.**

Walk the four prompt types (ZAP, CIP, PREP, SPIKE — GPM §3) and the four modes (DISCOVERY → PROTOTYPE → DELIVERY → HARDENING — Core §1). The single most important idea to land: *mode determines ceremony*. A throwaway prototype gets a five-line ZAP; a payment component gets the full DELIVERY template. Teams that miss this either drown in checklists or ship untested core logic — usually both, alternately.

### Minutes 5–8 — Declare the mode
For the chosen feature, the team declares a mode together using the Core §1 tables. Expect debate; the debate *is* the training. Record the mode and the one-line rationale.

### Minutes 8–18 — Write a ZAP together
Architect drives, using `zap-template-v3.md` scaled to the declared mode. Stakeholders supply business rules with concrete values ("10% student discount, max €50" — never "handle discounts"). Developers flag every interface reference as (verified)/(NEW)/(ASSUMED).

Run the ZAP quality checklist aloud, including the anti-bureaucracy test. Then generate.

### Minutes 18–25 — Review in role
- **Stakeholders:** does the generated logic match the business rules? Write the Integration Note: *"This [component] feeds into [process], so it must [critical rule]."*
- **Developers:** is it technically sound? Were tests generated first, per the Test Expectations?
- **Reviewer:** run the DoD check at the declared mode's level (Core §1 + §3).

Every flag raised here is a ZAP gap, not an AI failure — say this explicitly; it reframes rework as prompt debt (GPM §5: rework rate > 30 % means prompts are underspecified, not agents underperforming).

### Minutes 25–30 — Commit and baseline
- Agree: next 2 features run through GPM; Architect authors prompts initially
- Set up the shared prompt library (prompts + outputs + Contract Snapshots + Architecture Memory)
- **Baseline before you claim:** record current cycle time, rework rate, and defect data *now*. GPM's value gets measured against your own baseline after 5+ components (GPM §7 percentile forecasting) — not against adoption-brochure numbers. If a number has no baseline, the honest status is MEASURE FIRST.

## First Real Session (60–90 min, within a week)

1. **Phase 0 sliver (10 min):** glossary terms for this feature; value hypothesis; smoke-test outline (GPM §4 Phase 0)
2. **ZAP (30 min):** author → peer-review ritual (stakeholder reads aloud, engineer flags gaps — v1's best invention, retained) → generate → review
3. **Pull Gate + Contract Snapshot (10 min):** snapshot the accepted component (Core §4.1)
4. **CIP if wiring is needed (20–30 min):** per `cip-template-v3.md`
5. **Retro (10 min):** GPM §8 template — including the mode check: was the declared mode right?

## Common First-Session Failures

| Symptom | Actual cause | Fix |
|---|---|---|
| "AI ignored our business rules" | Rules stated without values | Concrete numbers, thresholds, examples in the ZAP |
| "Output doesn't match our standards" | Standards live in heads, not ADRs | Write the cross-cutting ADRs (GPM Phase 0); reference, don't restate |
| "Stakeholders zoned out" | They were shown code | They validate Integration Notes and smoke tests, never syntax |
| "This is slower than just coding" | DELIVERY ceremony on DISCOVERY work | Re-declare the mode; Core §1 exists for exactly this |
| "Generated code contradicted our repo" | Unverified references in the ZAP | Mark (verified)/(NEW)/(ASSUMED); executor halts on mismatch instead of improvising |

## Measuring Success — honestly

Track from day one (GPM §7): component cycle time, rework rate + cause, DoD violations caught, waste signals. After 5+ components you can forecast ("85 % probability of acceptance within [85th-percentile CT]") and compare against *your* baseline. Publish no percentage you didn't measure. The v1/v2.0 guides claimed "60 % faster" and "95 % fewer vulnerabilities" with no source — those numbers are retired, unmourned.

---

## Provenance and maintenance
- Workshop structure inherited from gpm-quickstart v1 (2024-era); mode integration, verification marking, and baseline discipline added in v3.
- Re-verify section references against gpm-v2.1 and core-specification-v1 when either bumps.
- v3.0 — 2026-07-02.
