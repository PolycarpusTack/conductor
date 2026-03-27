import { describe, test, expect } from 'bun:test'
import { estimateCost, MODEL_COSTS } from '../cost-estimator'

describe('estimateCost', () => {
  test('matches claude-sonnet model family', () => {
    const cost = estimateCost('claude-sonnet-4-5-20250514', 1000)
    expect(cost).toBe(1000 * MODEL_COSTS['claude-sonnet'])
  })

  test('matches claude-opus model family', () => {
    const cost = estimateCost('claude-opus-4-5', 500)
    expect(cost).toBe(500 * MODEL_COSTS['claude-opus'])
  })

  test('matches gpt-4o-mini before gpt-4o (substring ordering)', () => {
    const cost = estimateCost('gpt-4o-mini-2024-07-18', 1000)
    expect(cost).toBe(1000 * MODEL_COSTS['gpt-4o-mini'])
    // Should NOT match the more expensive gpt-4o rate
    expect(cost).not.toBe(1000 * MODEL_COSTS['gpt-4o'])
  })

  test('matches gpt-4o for non-mini models', () => {
    const cost = estimateCost('gpt-4o-2024-11-20', 1000)
    expect(cost).toBe(1000 * MODEL_COSTS['gpt-4o'])
  })

  test('matches gemini models', () => {
    expect(estimateCost('gemini-2.0-flash-exp', 1000)).toBe(1000 * MODEL_COSTS['gemini-2.0-flash'])
    expect(estimateCost('gemini-2.5-pro-preview', 1000)).toBe(1000 * MODEL_COSTS['gemini-2.5-pro'])
  })

  test('is case insensitive', () => {
    const cost = estimateCost('Claude-Sonnet-4-5', 1000)
    expect(cost).toBe(1000 * MODEL_COSTS['claude-sonnet'])
  })

  test('returns 0 for unknown models', () => {
    expect(estimateCost('llama-3-70b', 1000)).toBe(0)
    expect(estimateCost('', 1000)).toBe(0)
  })

  test('returns 0 for 0 tokens', () => {
    expect(estimateCost('claude-sonnet-4-5', 0)).toBe(0)
  })
})
