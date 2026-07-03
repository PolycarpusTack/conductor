# Guided Partnership Model — Documentation Index v3.1

> Single index for the GPM ecosystem. Replaces `README.md` (v1) and `README-enhanced.md` (v2.0). The basic/enhanced fork is retired: **one document tree, rigor scaled by execution mode** (Core §1), not by which copy of the docs you opened.

GPM is a pipeline for taking an idea to kickstarted development with an AI drafting partner: humans architect, AI executes, humans validate, and governance scales with the maturity of the work.

## The Pipeline

```
Idea ──► Solution Design ──► Development Plan + Backlog ──► Kickstarted Development
         solution-design-     backlog-builder-v5.1          gpm-v2.1 phases 0–4
         template-v1          (readiness decision, ADRs,    (tracer bullet first,
         (interrogate, draft,  Architecture Memory, EPICs,   then ZAP/CIP/PREP/SPIKE
         self-score ≥ 7/9)     tasks with pull gates)        execution per mode)
```

Every stage gate is explicit: the design must clear BB §5 (≥ 7/9, no unmitigated High risk) before decomposition; every task clears its Pull Gate before execution; every component clears the mode's DoD before acceptance.

**Provider-agnostic by design:** the methodology documents and templates are plain markdown conversation protocols — they work identically pasted into Claude, ChatGPT/Codex, or any capable model. Only the agent wrappers are runtime-specific: Claude Code frontmatter for the `*-agent` files, AGENTS.md ports for Codex. One methodology, two (or N) runtimes; the wrapper is the only thing that forks.

---

## Document Map

```
core-specification-v1.md          ← principles, modes, DoD, compression, economics (defined ONCE)
├── solution-design-template-v1.md ← pipeline front door: idea → BB-ready design (provider-agnostic)
├── gpm-v2.1.md                   ← the methodology: roles, phases, prompt types, collaboration
│   ├── gpm-partner-agent-v2.md   ← execution agent implementing GPM
│   ├── gpm-onboarding-v3.md      ← 30-minute team workshop
│   ├── zap-template-v3.md        ← component prompt authoring guide
│   ├── cip-template-v3.md        ← integration prompt authoring guide
│   └── gen-tests-template-v3.md  ← test-suite augmentation guide
├── backlog-builder-v5.1.md       ← solution design → backlog framework
│   ├── backlog-builder-policy-kernel + backlog-builder-annexes  ← per AGENT-INDEX; supersedes backlog-builder-agent-v2
│   └── backlog-planner-agent, backlog-critic-agent              ← planning + adversarial review of the decomposition
├── AGENT-INDEX.md                ← Agents/, 64 deployable subagents — single source of truth for the library
├── current-state-evaluator-agent.md  ← seven-dimension project diagnostic (run first) — NOT yet in Agents/; see index
└── output-evaluation-prompt.md   ← per-response quality review
```

**Reading order for a new team:** current-state-evaluator (know where you are) → Core §1 (pick a mode) → gpm-onboarding-v3 (run the workshop) → templates as needed.

**Reading order for a new project:** solution-design-template-v1 (interrogate + draft) → backlog-builder (decompose) → gpm-v2.1 Phase 0–1 (glossary + tracer bullet) → execute.

**Maintenance rule (Core §7):** one home per fact. Principles live in the Core Spec; methodology in GPM v2.1; templates only *apply* them. Never restate a principle downstream.

## What the prompt types are for

| Type | Job | Template |
|---|---|---|
| ZAP | Build one component, zero implementation assumptions | zap-template-v3 |
| CIP | Wire validated components into a flow | cip-template-v3 |
| PREP | Restructure ahead of a feature (Hat: PREPARATORY) | GPM v2.1 §4 |
| SPIKE | Time-boxed throwaway exploration | GPM v2.1 §3 |
| GEN_TESTS | Augment an existing TDD suite with integration/security/perf/mutation layers | gen-tests-template-v3 |

## Migration Table — where every old file went

| Old file | Status | Successor / rationale |
|---|---|---|
| gpm-complete-guide.md | **Superseded** | core-specification-v1 + gpm-v2.1 (principles and workflow); collaborative-layer details absorbed into gpm-v2.1 §5 and onboarding-v3 |
| gpm-enhanced-framework.md | **Superseded** | Its quality content became mode-gated sections of the v3 templates; its QDF CLI, dashboards, and roadmap were fictional and are removed |
| README.md / README-enhanced.md | **Replaced** | This file |
| gpm-quickstart.md / gpm-enhanced-quickstart.md | **Replaced** | gpm-onboarding-v3.md |
| zap-template.md / enhanced-zap-template.md | **Replaced** | zap-template-v3.md (one template, mode-scaled) |
| cip-template.md / enhanced-cip-template.md | **Replaced** | cip-template-v3.md; v1's 38 KB worked example was a solution design in disguise → that content pattern belongs in BB §11 |
| gen-tests-template.md / enhanced-gen-tests-template.md | **Replaced** | gen-tests-template-v3.md — repositioned from "Phase 3 test generation" (test-after, contradicts P1) to suite augmentation |
| prompt-library-integration.md | **Retired pending verification** | Maps GPM phases to a 200+ prompt library by path; every path is a load-bearing claim. Re-adopt only after verifying the library exists at those paths — wrong runbooks are worse than none. The *pattern* (enhance a ZAP with a specialist prompt) is sound and needs no catalog. |
| gpm-tool-implementation-plan.md / nlp-gpm-tool-plan.md | **Retired — superseded by reality** | The 12-month, 8–12-engineer, $1.2–1.8 M NLP orchestrator these planned now exists as backlog-builder-agent + gpm-partner-agent running on general-purpose models. The intent-classification layer became "the model reads the request." Kept in archive as a lesson in how fast the substrate moves. |

## Claims policy

This documentation makes **no unsourced quantitative claims**. The v1/v2.0 adoption metrics ("60 % faster", "95 % fewer vulnerabilities") and the three enterprise case studies had no source and are removed. GPM's effect on *your* team is measured per GPM §7: baseline first, 5+ components, percentile forecasting. Anything else is marketing, and this is an operating manual.

---

## Provenance and maintenance
- Re-verify the Document Map whenever any component bumps versions; this index is the second home of every filename, and filenames drift.
- v3.2 — 2026-07-02: document map aligned to AGENT-INDEX (backlog builder = policy-kernel + annexes; evaluator flagged as absent from Agents/). v3.1 — pipeline framing, solution-design front door, provider note. v3.0 — initial consolidation.
