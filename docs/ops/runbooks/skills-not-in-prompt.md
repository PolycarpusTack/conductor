# Runbook — attached skill missing from an agent's prompt

Symptom: a skill is attached to an agent but its content doesn't seem to shape
the agent's output, or the prompt shows truncation markers. (ADR-0010, G3-1.)

## Checks, in order

1. **Was it injected at all?** The step's `StepExecution.evidence` JSON carries
   `skillsInjected: [titles]` (HTTP path). Empty despite an attach means the
   skill dropped out at load time — see 2/3.
2. **Workspace boundary.** Skills are workspace-scoped; the load filters by the
   agent's project's workspace. A project with **no workspace** injects nothing
   (attach is also rejected at write time — but a project whose workspace was
   changed after the attach drops the skill silently at load). Fix: re-attach
   from the correct workspace, or assign the project a workspace.
3. **Deleted/moved skill.** A stale id in `Agent.skillIds` silently drops out
   of the block by design (never errors a dispatch). Re-open the agent editor —
   the picker shows only currently-valid attachments — and re-save.
4. **Cap markers.**
   - `[skill truncated]` — one skill body exceeded 8,000 chars; shorten the
     skill or split it.
   - `[skills omitted: K of N shown — reduce attached skills]` — the combined
     block exceeded 16,000 chars; detach or shorten skills. Injection is in
     attach order, so the first attached skills win.
5. **Placement surprises.** If the agent's systemPrompt template contains
   `{{agent.skills}}`, the block substitutes THERE (and only there); without
   the token it is appended at the end. An empty attach resolves the token to
   an empty string — no literal `{{agent.skills}}` ever reaches a model/CLI.

Caps live in `src/lib/server/skill-prompt.ts` (SKILL_CHAR_CAP /
SKILLS_BLOCK_CHAR_CAP); tests pin them.
