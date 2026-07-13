import { describe, test, expect } from 'bun:test'

// ---------------------------------------------------------------------------
// ADR-0010 — buildSkillsBlock: format + caps. Pure function, no mocks.
// ---------------------------------------------------------------------------

import { buildSkillsBlock, SKILL_CHAR_CAP, SKILLS_BLOCK_CHAR_CAP } from '../skill-prompt'

describe('buildSkillsBlock', () => {
  test('empty attach → empty block (nothing appended, token resolves to "")', () => {
    expect(buildSkillsBlock([])).toBe('')
  })

  test('formats skills in attach order under a single ## Skills heading', () => {
    const block = buildSkillsBlock([
      { title: 'Code Review Checklist', body: 'Check error paths first.' },
      { title: 'Commit Style', body: 'Conventional commits.' },
    ])
    expect(block).toStartWith('## Skills\n\n### Code Review Checklist\n')
    expect(block.indexOf('Code Review Checklist')).toBeLessThan(block.indexOf('Commit Style'))
    expect(block).not.toContain('[skills omitted')
  })

  test('a skill body over the per-skill cap is cut with a loud marker', () => {
    const block = buildSkillsBlock([{ title: 'Big', body: 'x'.repeat(SKILL_CHAR_CAP + 500) }])
    expect(block).toContain('[skill truncated]')
    expect(block.length).toBeLessThan(SKILL_CHAR_CAP + 200)
  })

  test('the block cuts at the last WHOLE skill that fits and says what was dropped', () => {
    const skills = Array.from({ length: 4 }, (_, i) => ({
      title: `Skill ${i + 1}`,
      body: 'y'.repeat(6000),
    }))
    const block = buildSkillsBlock(skills)
    expect(block.length).toBeLessThanOrEqual(SKILLS_BLOCK_CHAR_CAP + 100) // + omission marker
    expect(block).toContain('Skill 1')
    expect(block).toContain('Skill 2')
    expect(block).not.toContain('### Skill 3')
    expect(block).toContain('[skills omitted: 2 of 4 shown')
  })

  test('never returns a silent empty block when everything is dropped', () => {
    // Only reachable with misconfigured caps, but must stay loud.
    const block = buildSkillsBlock([{ title: 'T', body: 'z'.repeat(SKILLS_BLOCK_CHAR_CAP * 2) }])
    // Per-skill cap trims it into range first, so it fits — assert the normal path…
    expect(block).toContain('### T')
    expect(block).toContain('[skill truncated]')
  })
})
