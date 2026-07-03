# Output Evaluation Prompt

> Paste this after any LLM response to get a structured quality review.
> Works in any chat interface — Claude.ai, ChatGPT, Gemini, etc.
> No agent framework required.

---

Evaluate the response you just gave me. Be rigorous and specific — not kind, not vague. For every issue, name the exact location and cite the principle violated. For every strength, cite specific evidence. Never say "looks good" without proof.

Run these checks against your previous response:

**1. Scope** — Did you answer what I asked, and only what I asked? Did you add things I didn't request? Did you miss parts of my request? Did you make assumptions without stating them?

**2. Accuracy** — Are your technical claims correct? Are there any APIs, methods, or features you described that don't actually exist? Did you present guesses as facts? Where you were uncertain, did you say so?

**3. Code quality (if code was produced):**
- Were tests defined before implementation or after? Do the tests test behaviour or implementation details?
- Naming: do names reveal intent? Any generic names (data, result, item, temp)?
- Functions: any longer than 40 lines? Any boolean parameters? Any doing more than one thing?
- Duplication: any pattern repeated that should be extracted?
- Error handling: any null returns, empty catches, or swallowed exceptions?
- Architecture: does any business logic depend on a framework, database, or HTTP type?

**4. Planning quality (if a backlog, plan, or stories were produced):**
- Do stories have "so that" clauses with real value statements?
- Are estimates in relative sizes (S/M/L) or mapped to calendar days? (Calendar days = violation)
- Are there single-point date commitments without confidence ranges?
- Do tasks mix adding features with restructuring code? (Each task should do one or the other, never both)
- Is there a thin end-to-end slice as the first deliverable, or does it build layer by layer?

**5. Terminology** — Did you use terms consistently? Did you use different words for the same concept in different parts of the response? If a domain glossary was established earlier in this conversation, did you follow it?

**6. Invisible shortcuts** — Did you simplify anything without saying so? Hardcoded values? Skipped edge cases? Deferred error handling? Each shortcut should be explicitly noted, not silently taken.

**7. Proportionality** — Is the response at the right level of detail for what I asked? Too much ceremony for a simple question? Too shallow for a complex one?

Format your evaluation as:

```
VERDICT: [ACCEPT / REVISE / REJECT]

ISSUES (if any):
  [CRITICAL/IMPORTANT/MINOR]: [specific finding with location]
  ...

STRENGTHS:
  [specific thing done well with evidence]
  ...

FIXES NEEDED (if REVISE):
  1. [specific change]
  2. [specific change]
  ...
```
