// ADR-0010: composes the `## Skills` block injected into an agent's resolved
// system prompt. Pure — the caller loads the attached skills (workspace-
// filtered) and this module only formats and caps.

export const SKILL_CHAR_CAP = 8_000
export const SKILLS_BLOCK_CHAR_CAP = 16_000

export interface InjectableSkill {
  title: string
  body: string
}

/**
 * Build the skills block, in attach order, under the ADR-0010 caps:
 * each skill body is cut at SKILL_CHAR_CAP with a `[skill truncated]` marker,
 * and the block is cut at the last WHOLE skill that fits SKILLS_BLOCK_CHAR_CAP,
 * ending with a loud omission marker when skills were dropped.
 * Returns '' when there is nothing to inject.
 */
export function buildSkillsBlock(skills: InjectableSkill[]): string {
  if (skills.length === 0) return ''

  const sections: string[] = []
  let length = '## Skills'.length
  let shown = 0

  for (const skill of skills) {
    const body =
      skill.body.length > SKILL_CHAR_CAP
        ? `${skill.body.slice(0, SKILL_CHAR_CAP)}\n[skill truncated]`
        : skill.body
    const section = `### ${skill.title}\n${body}`
    if (length + section.length + 2 > SKILLS_BLOCK_CHAR_CAP) break
    sections.push(section)
    length += section.length + 2
    shown++
  }

  if (shown === 0) {
    // First skill alone exceeds the block cap (only possible if per-skill and
    // block caps are reconfigured badly) — still be loud rather than silent.
    return `## Skills\n\n[skills omitted: 0 of ${skills.length} shown — reduce attached skills]`
  }

  const omission =
    shown < skills.length
      ? `\n\n[skills omitted: ${shown} of ${skills.length} shown — reduce attached skills]`
      : ''

  return `## Skills\n\n${sections.join('\n\n')}${omission}`
}
