# Solution Design Template v1.0 — The Pipeline's Front Door

> **Depends on:** `core-specification-v1.md` (modes §1, P6, P11, economics §5)
> **Feeds:** Backlog Builder §5 quality gate — the output of this template is the input to `backlog-builder-agent`.
> **Provider-agnostic:** this is a plain-markdown conversation protocol. It works pasted into Claude, ChatGPT/Codex, or any capable model; no agent runtime required. Only the downstream agents (backlog-builder, gpm-partner) are wrapper-specific.

**Use this when:** turning an idea, feature request, or requirement set into a Solution Design that Backlog Builder can score ≥ 7/9 and decompose.
**Do NOT use for:** designing a single component (→ ZAP), planning work on an already-designed system (→ Backlog Builder directly), or exploration where the domain itself is unknown (→ run DISCOVERY-mode SPIKEs first; a solution design authored before the domain concepts stabilise is fiction with headings).

---

## 1. The Protocol

Three turns, human as architect, AI as drafting partner. Paste §2 as the working prompt.

**Turn 1 — Intake.** Human provides the raw material: the idea, any existing docs, constraints, and the declared execution mode for the build (Core §1). The AI does *not* draft yet.

**Turn 2 — Interrogation.** The AI asks **at most 7 questions**, only for what the material cannot answer — typically: the core user journey, the hardest constraint, what already exists (systems, schemas, APIs), what "done" measurably means, and what is explicitly out of scope. More than 7 questions means the intake was too thin; fewer than 3 usually means the AI is about to assume things.

**Turn 3 — Draft + self-score.** The AI produces the design per §3, then scores itself against BB §5 (Clarity / Feasibility / Completeness, 1–3 each) and lists what would raise each sub-score. The human reviews, corrects, and re-runs turn 3 until the self-score is honest and ≥ 7/9 — then hands to Backlog Builder, which scores independently. A design that gamed its self-score gets caught at the gate; that's the gate's job.

## 2. The Working Prompt

```markdown
You are my solution-design partner. I am the architect; you draft, I decide.
We produce a Solution Design for Backlog Builder v5.1 to decompose.

Process:
1. I give you the idea, constraints, existing-system context, and execution
   mode. Do not draft yet.
2. Ask me at most 7 questions — only what my material cannot answer.
3. Draft the design using the structure I provide, then self-score it
   (Clarity, Feasibility, Completeness, 1–3 each) and tell me what would
   raise each score. Iterate on my corrections.

Rules:
- Mark every claim about existing systems (verified) — I confirmed it or you
  read it — or (ASSUMED) with a verification step. Never present an
  assumption as a fact about my codebase.
- Every numeric NFR cites a source (baseline, SLA, regulation) or is written
  as MEASURE FIRST: <how to establish it>. No invented thresholds.
- One term per concept: build the Domain Glossary as you go and use it.
- Scope discipline: unrequested features go in a "Deliberately excluded"
  list with one line of reasoning, not in the design.
- Flag every decision that is expensive to reverse (Core §5.1) as an ADR
  candidate with at least two options and a recommendation. The decision
  itself is mine.
```

## 3. Required Structure (BB §11, annotated)

1. **Business Context** — problem, personas, KPIs, timeline. Include the value hypothesis: *"We believe [X] achieves [Y] for [persona], measured by [metric]"* (GPM §4 Phase 0).
2. **Architecture Overview** — components, responsibilities, relationships, stack. Existing components marked (verified); new ones marked NEW.
3. **Data Models** — entities, attributes, sample payloads. Existing tables/columns (verified) against the real schema.
4. **APIs & Interfaces** — endpoints, schemas, errors, auth. Reference cross-cutting ADRs rather than restating conventions.
5. **Non-Functional Requirements** — performance, scalability, security, compliance. Numbers sourced or MEASURE FIRST. Compliance names the specific control, never a framework wall.
6. **Known Constraints** — budget, legacy, skills, and the political ones nobody writes down but everybody routes around.
7. **User Journeys** — primary flows, critical paths, exceptions. Each critical journey gets a 3–5 step smoke-test outline a stakeholder can execute.
8. **Domain Glossary** — every entity, role, status, action. This glossary is the seed of the enforced glossary downstream (P3); sloppiness here compounds through every EPIC.

Plus two sections BB §11 doesn't list but BB §5 implicitly punishes you for omitting:

9. **Assumptions Ledger** — every (ASSUMED) claim, with impact, risk, and its verification step. High-impact assumptions become spike candidates in EPIC 1.
10. **ADR Candidates** — the irreversible decisions, each with options considered and a recommendation awaiting the architect's call (P6).

## 4. Quality Bar

- [ ] Someone who wasn't in the conversation can decompose this — the design is self-contained
- [ ] Zero unmarked claims about existing systems; zero unsourced numbers
- [ ] Glossary terms used consistently within the design itself (drift here = drift everywhere)
- [ ] "Deliberately excluded" list exists — a design with no exclusions has no scope
- [ ] Self-score is defensible line by line, not aspirational
- [ ] Anti-bureaucracy check: design depth matches the declared mode — a DISCOVERY-mode experiment does not get a 10-section design; sections 1, 2, 7, 8 suffice

## 5. Specialist Agent Hooks (agent runtime only)

When running in an agent runtime (Claude Code with the suite installed, or the Codex/AGENTS.md port), invoke specialists at the stage where their judgment pays. All agents below are **verified against AGENT-INDEX.md (Agents/, 64 agents)** as of 2026-07-02. Priority marks (⭐ core / ○ situational) are the index's own. Route model tiers per the Core §6 matching rule: judgment → Opus, generation from clear spec → Sonnet, checklist verification → Haiku.

| Stage | Agent(s) | Priority | Contribution |
|---|---|---|---|
| Turn 2 — Interrogation | `domain-discovery-coach`, `knowledge-crunching-coach` | ○ | Drive the questioning itself: exploration structure, knowledge-crunching with the domain expert |
| Turn 2 — Interrogation | `implicit-concept-extractor` | ○ | Surfaces concepts the intake material assumes but never names — prime source of the ≤ 7 questions |
| §3.1 Business Context | `product-owner-coach`, `domain-vision-generator` (greenfield) | ○ | Sharpens the value hypothesis; drafts the domain vision statement |
| §3.2 Architecture Overview | `architecture-assessment-facilitator`, `integration-pattern-advisor`, `boundary-guard` | ○ / ○ / ⭐ | Assesses existing structure; deliberate sync/async/event choices; bounded-context violations before they're designed in |
| §3.3 Data Models | `aggregate-design-reviewer`, `building-block-classifier` | ⭐ / ○ | Aggregate boundaries and invariants; entity/VO/service classification before the schema hardens |
| §3.5 NFRs | `quality-attribute-analyzer` | ○ | Turns "fast and secure" into scenario-based, testable attributes |
| §3.8 Glossary | `ubiquitous-language-guard`, `core-domain-identifier` | ⭐ / ○ | Term consistency from day one; strategic classification (Core vs Generic) |
| §3.9 Assumptions (legacy in scope) | `legacy-code-strategist` | ○ | Which assumptions about old code need characterisation tests before they're trusted |
| §3.10 ADR candidates | `architectural-decision-recorder` | ⭐ | Formats candidates with context, alternatives, consequences, review date (P6) |
| Post-handover review | `backlog-critic-agent` | ○ | Adversarial pass over the decomposed backlog before execution begins |

**Known gap:** `current-state-evaluator` (the recommended brownfield pre-step) is **not in AGENT-INDEX.md** — it exists as a standalone agent file but is absent from `Agents/`. Until it's added to the library, invoke it by pasting its file directly; the hook stays flagged here so the gap doesn't get silently absorbed.

Sequencing rule: specialists advise **into** the draft; they do not each produce a document. The solution-design conversation stays the single artifact — one home per fact applies to agent output too. In plain-chat mode (no runtime), paste the relevant agent's file content into the conversation as a role instruction instead; the templates are the portable layer, the invocation mechanism is not. Hooking more agents than this table is possible but suspect: ten advisory voices into one design is counsel, sixty-four is noise.

## 6. Handover

Feed the accepted design to the backlog builder — in the current library that is `backlog-builder-policy-kernel` (+ `backlog-builder-annexes`); in plain chat, paste BB v5.1 + the design into any capable model. The Readiness Decision, Critical Gaps, and EPIC decomposition come back per BB §2's output order; run `backlog-critic-agent` over the result before execution. The Hadron MgX-integration plan is the reference example of what a design looks like after this pipeline has run: readiness decision, glossary, assumptions ledger, ADRs, Architecture Memory, then EPICs.

---

## Provenance and maintenance
- Structure §3.1–8 mirrors BB v5.1 §11; if BB bumps, re-verify. Self-score rubric mirrors BB §5.
- The ≤ 7-question bound is a working default, not doctrine — tune per team and note the change here.
- v1.2 — 2026-07-02: hooks verified against AGENT-INDEX.md (8/9 confirmed; current-state-evaluator absent from Agents/, flagged); interrogation-phase, data-model, and post-handover hooks added from the index; priorities adopted from the index. v1.1 — hooks added (unverified). v1.0 — initial.
