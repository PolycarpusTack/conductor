import { describe, test, expect } from 'bun:test'
import { scoreEntry } from '../wizard-composer'
import type { PromptLibraryEntry } from '@/types/prompt-library'

function makeEntry(overrides: Partial<PromptLibraryEntry>): PromptLibraryEntry {
  return {
    id: 'test-id',
    category: 'Test',
    title: 'Test Entry',
    description: '',
    charCount: 1000,
    relativePath: 'Test/test.md',
    ...overrides,
  }
}

describe('scoreEntry', () => {
  test('returns higher score when terms appear in title', () => {
    const rustEntry = makeEntry({ title: 'Rust Tauri Code Analysis Agent', category: 'agents' })
    const otherEntry = makeEntry({ title: 'Gemini CLI', category: 'Google' })
    const terms = ['rust', 'tauri', 'analysis']

    expect(scoreEntry(rustEntry, terms)).toBeGreaterThan(scoreEntry(otherEntry, terms))
  })

  test('returns higher score for category match', () => {
    const agentEntry = makeEntry({ category: 'agents', title: 'My Agent' })
    const genericEntry = makeEntry({ category: 'Anthropic', title: 'Claude Sonnet' })
    const terms = ['agent', 'custom']

    expect(scoreEntry(agentEntry, terms)).toBeGreaterThan(scoreEntry(genericEntry, terms))
  })

  test('returns 0 for completely unrelated entry', () => {
    const entry = makeEntry({ title: 'Gemini Voice', category: 'Google', description: 'A voice UI' })
    expect(scoreEntry(entry, ['rust', 'security', 'tauri'])).toBe(0)
  })
})
