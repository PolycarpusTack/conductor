import { describe, test, expect, mock } from 'bun:test'
import { captureTraceContext, dispatchWithTelemetry } from '../telemetry'
import type { DispatchParams, RuntimeAdapter } from '../adapters/types'

// All tests run against the no-op OTel tracer (no SDK registered) — the
// wrapper must be fully transparent in that mode.

const baseParams = {
  systemPrompt: 'sys',
  taskContext: 'ctx',
  mode: 'analyze',
  model: 'test-model',
  runtimeConfig: {},
}

function makeAdapter(dispatch: RuntimeAdapter['dispatch']): RuntimeAdapter {
  return { id: 'mock', name: 'Mock', available: true, dispatch }
}

describe('captureTraceContext', () => {
  test('returns null when no trace is active', () => {
    expect(captureTraceContext()).toBeNull()
  })
})

describe('dispatchWithTelemetry', () => {
  test('passes params through and returns the adapter result', async () => {
    const dispatch = mock((_params: DispatchParams) =>
      Promise.resolve({ output: 'ok', tokensUsed: 7, cost: 0.01 }))
    const result = await dispatchWithTelemetry(makeAdapter(dispatch), baseParams)
    expect(result.output).toBe('ok')
    expect(dispatch).toHaveBeenCalledTimes(1)
    expect(dispatch.mock.calls[0][0]).toEqual(baseParams)
  })

  test('rethrows adapter errors untouched', async () => {
    const boom = new Error('adapter exploded')
    const dispatch = mock(() => Promise.reject(boom))
    await expect(dispatchWithTelemetry(makeAdapter(dispatch), baseParams)).rejects.toBe(boom)
  })

  test('tolerates a persisted trace carrier', async () => {
    const dispatch = mock(() => Promise.resolve({ output: 'ok' }))
    const carrier = JSON.stringify({ traceparent: '00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01' })
    const result = await dispatchWithTelemetry(makeAdapter(dispatch), baseParams, carrier)
    expect(result.output).toBe('ok')
  })

  test('tolerates corrupt trace carrier JSON', async () => {
    const dispatch = mock(() => Promise.resolve({ output: 'ok' }))
    const result = await dispatchWithTelemetry(makeAdapter(dispatch), baseParams, 'not-json')
    expect(result.output).toBe('ok')
  })
})
