import { describe, test, expect } from 'bun:test'
import { evaluateCondition, resolveNextSteps, type StepCondition, type StepContext, type StepEdge } from '../condition-evaluator'

// ===========================================================================
// evaluateCondition
// ===========================================================================

describe('evaluateCondition', () => {
  const ctx: StepContext = {
    output: 'The risk level is HIGH and needs review',
    status: 'done',
    tokensUsed: 1500,
    error: null,
  }

  test('contains — matches case-insensitively', () => {
    expect(evaluateCondition({ field: 'output', operator: 'contains', value: 'high' }, ctx)).toBe(true)
    expect(evaluateCondition({ field: 'output', operator: 'contains', value: 'LOW' }, ctx)).toBe(false)
  })

  test('not_contains — inverse of contains', () => {
    expect(evaluateCondition({ field: 'output', operator: 'not_contains', value: 'low' }, ctx)).toBe(true)
    expect(evaluateCondition({ field: 'output', operator: 'not_contains', value: 'high' }, ctx)).toBe(false)
  })

  test('equals — exact string match', () => {
    expect(evaluateCondition({ field: 'status', operator: 'equals', value: 'done' }, ctx)).toBe(true)
    expect(evaluateCondition({ field: 'status', operator: 'equals', value: 'failed' }, ctx)).toBe(false)
  })

  test('gt — numeric greater than', () => {
    expect(evaluateCondition({ field: 'tokensUsed', operator: 'gt', value: '1000' }, ctx)).toBe(true)
    expect(evaluateCondition({ field: 'tokensUsed', operator: 'gt', value: '2000' }, ctx)).toBe(false)
  })

  test('lt — numeric less than', () => {
    expect(evaluateCondition({ field: 'tokensUsed', operator: 'lt', value: '2000' }, ctx)).toBe(true)
    expect(evaluateCondition({ field: 'tokensUsed', operator: 'lt', value: '500' }, ctx)).toBe(false)
  })

  test('matches — regex match', () => {
    expect(evaluateCondition({ field: 'output', operator: 'matches', value: 'risk.*HIGH' }, ctx)).toBe(true)
    expect(evaluateCondition({ field: 'output', operator: 'matches', value: '^DONE$' }, ctx)).toBe(false)
  })

  test('matches — invalid regex returns false', () => {
    expect(evaluateCondition({ field: 'output', operator: 'matches', value: '[invalid' }, ctx)).toBe(false)
  })

  test('handles null field values gracefully', () => {
    expect(evaluateCondition({ field: 'error', operator: 'contains', value: 'timeout' }, ctx)).toBe(false)
    expect(evaluateCondition({ field: 'error', operator: 'equals', value: '' }, ctx)).toBe(true)
  })

  test('handles null tokensUsed as 0 for numeric comparisons', () => {
    const noTokens: StepContext = { ...ctx, tokensUsed: null }
    expect(evaluateCondition({ field: 'tokensUsed', operator: 'gt', value: '0' }, noTokens)).toBe(false)
  })
})

// ===========================================================================
// resolveNextSteps
// ===========================================================================

describe('resolveNextSteps', () => {
  const ctx: StepContext = {
    output: 'Risk: HIGH',
    status: 'done',
    tokensUsed: 1500,
    error: null,
  }

  test('returns matching conditional edge targets', () => {
    const edges: StepEdge[] = [
      { targetStepId: 'qa-step', condition: { field: 'output', operator: 'contains', value: 'HIGH' } },
      { targetStepId: 'deploy-step', condition: { field: 'output', operator: 'contains', value: 'LOW' } },
    ]
    expect(resolveNextSteps(edges, ctx)).toEqual(['qa-step'])
  })

  test('falls back to unconditional edges when no conditions match', () => {
    const edges: StepEdge[] = [
      { targetStepId: 'qa-step', condition: { field: 'output', operator: 'contains', value: 'CRITICAL' } },
      { targetStepId: 'default-step' }, // no condition = default
    ]
    expect(resolveNextSteps(edges, ctx)).toEqual(['default-step'])
  })

  test('returns all matching conditional edges (parallel branching)', () => {
    const edges: StepEdge[] = [
      { targetStepId: 'qa-step', condition: { field: 'output', operator: 'contains', value: 'HIGH' } },
      { targetStepId: 'alert-step', condition: { field: 'output', operator: 'contains', value: 'Risk' } },
    ]
    expect(resolveNextSteps(edges, ctx)).toEqual(['qa-step', 'alert-step'])
  })

  test('conditional matches take priority over unconditional defaults', () => {
    const edges: StepEdge[] = [
      { targetStepId: 'qa-step', condition: { field: 'output', operator: 'contains', value: 'HIGH' } },
      { targetStepId: 'default-step' }, // unconditional
    ]
    // conditional matched, so unconditional is skipped
    expect(resolveNextSteps(edges, ctx)).toEqual(['qa-step'])
  })

  test('returns empty array when no edges match and no defaults exist', () => {
    const edges: StepEdge[] = [
      { targetStepId: 'qa-step', condition: { field: 'output', operator: 'contains', value: 'CRITICAL' } },
    ]
    expect(resolveNextSteps(edges, ctx)).toEqual([])
  })

  test('returns all unconditional edges as defaults', () => {
    const edges: StepEdge[] = [
      { targetStepId: 'step-a' },
      { targetStepId: 'step-b' },
    ]
    expect(resolveNextSteps(edges, ctx)).toEqual(['step-a', 'step-b'])
  })

  test('handles empty edges array', () => {
    expect(resolveNextSteps([], ctx)).toEqual([])
  })
})
