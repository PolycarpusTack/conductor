import { describe, test, expect } from 'bun:test'
import { resolvePrompt } from '../resolve-prompt'

const baseCtx = {
  task: { title: 'Fix login timeout', description: 'Users report 30s timeouts on mobile' },
  step: { mode: 'analyze', instructions: 'Check server logs', previousOutput: 'Prior analysis results here' },
  mode: { label: 'Analyze', instructions: 'Investigate thoroughly and report findings.' },
  agent: { name: 'Support Agent', role: 'support', capabilities: 'triage, log-analysis, debugging' },
}

describe('resolvePrompt', () => {
  test('replaces task.title', () => {
    expect(resolvePrompt('Task: {{task.title}}', baseCtx)).toBe('Task: Fix login timeout')
  })

  test('replaces task.description', () => {
    expect(resolvePrompt('Desc: {{task.description}}', baseCtx)).toBe('Desc: Users report 30s timeouts on mobile')
  })

  test('replaces step.mode', () => {
    expect(resolvePrompt('Mode: {{step.mode}}', baseCtx)).toBe('Mode: analyze')
  })

  test('replaces step.instructions', () => {
    expect(resolvePrompt('Do: {{step.instructions}}', baseCtx)).toBe('Do: Check server logs')
  })

  test('replaces step.previousOutput', () => {
    expect(resolvePrompt('Prev: {{step.previousOutput}}', baseCtx)).toBe('Prev: Prior analysis results here')
  })

  test('replaces mode.label', () => {
    expect(resolvePrompt('Label: {{mode.label}}', baseCtx)).toBe('Label: Analyze')
  })

  test('replaces mode.instructions', () => {
    expect(resolvePrompt('{{mode.instructions}}', baseCtx)).toBe('Investigate thoroughly and report findings.')
  })

  test('replaces agent.name', () => {
    expect(resolvePrompt('Agent: {{agent.name}}', baseCtx)).toBe('Agent: Support Agent')
  })

  test('replaces agent.role', () => {
    expect(resolvePrompt('Role: {{agent.role}}', baseCtx)).toBe('Role: support')
  })

  test('replaces agent.capabilities', () => {
    expect(resolvePrompt('Can: {{agent.capabilities}}', baseCtx)).toBe('Can: triage, log-analysis, debugging')
  })

  test('replaces multiple placeholders in one string', () => {
    const template = 'Agent {{agent.name}} ({{agent.role}}) working on {{task.title}} in {{step.mode}} mode'
    expect(resolvePrompt(template, baseCtx)).toBe(
      'Agent Support Agent (support) working on Fix login timeout in analyze mode'
    )
  })

  test('leaves unknown placeholders as-is', () => {
    expect(resolvePrompt('{{unknown.var}} stays', baseCtx)).toBe('{{unknown.var}} stays')
  })

  test('leaves malformed placeholders as-is', () => {
    expect(resolvePrompt('{{noperiod}} and {single}', baseCtx)).toBe('{{noperiod}} and {single}')
  })

  test('handles null description gracefully', () => {
    const ctx = { ...baseCtx, task: { title: 'Test', description: null } }
    expect(resolvePrompt('Desc: {{task.description}}', ctx)).toBe('Desc: ')
  })

  test('handles null step fields gracefully', () => {
    const ctx = {
      ...baseCtx,
      step: { mode: 'develop', instructions: null, previousOutput: null },
    }
    expect(resolvePrompt('{{step.instructions}}|{{step.previousOutput}}', ctx)).toBe('|')
  })

  test('handles null agent fields gracefully', () => {
    const ctx = {
      ...baseCtx,
      agent: { name: 'Bot', role: null, capabilities: null },
    }
    expect(resolvePrompt('{{agent.role}}|{{agent.capabilities}}', ctx)).toBe('|')
  })

  test('handles null mode instructions gracefully', () => {
    const ctx = { ...baseCtx, mode: { label: 'Custom', instructions: null } }
    expect(resolvePrompt('{{mode.instructions}}', ctx)).toBe('')
  })

  test('handles empty template', () => {
    expect(resolvePrompt('', baseCtx)).toBe('')
  })

  test('handles template with no placeholders', () => {
    expect(resolvePrompt('Just plain text', baseCtx)).toBe('Just plain text')
  })

  test('handles consecutive placeholders', () => {
    expect(resolvePrompt('{{task.title}}{{step.mode}}', baseCtx)).toBe('Fix login timeoutanalyze')
  })

  test('replaces memory.recent', () => {
    const ctx = {
      ...baseCtx,
      memory: { recent: '- Prior task A\n- Prior task B', relevant: '' },
    }
    expect(resolvePrompt('Memory: {{memory.recent}}', ctx)).toBe(
      'Memory: - Prior task A\n- Prior task B'
    )
  })

  test('replaces memory.relevant', () => {
    const ctx = {
      ...baseCtx,
      memory: { recent: '', relevant: '- Fact: prod DB is at 10.0.0.5' },
    }
    expect(resolvePrompt('{{memory.relevant}}', ctx)).toBe('- Fact: prod DB is at 10.0.0.5')
  })

  test('missing memory context leaves placeholder', () => {
    // baseCtx has no memory key — placeholder should stay unresolved
    expect(resolvePrompt('{{memory.recent}}', baseCtx)).toBe('{{memory.recent}}')
  })

  test('both memory slots empty render as empty strings when present', () => {
    const ctx = { ...baseCtx, memory: { recent: '', relevant: '' } }
    expect(resolvePrompt('a{{memory.recent}}b{{memory.relevant}}c', ctx)).toBe('abc')
  })
})
