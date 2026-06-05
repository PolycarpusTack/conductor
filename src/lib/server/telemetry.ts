import { context, propagation, trace, SpanStatusCode } from '@opentelemetry/api'

import type { DispatchParams, DispatchResult, RuntimeAdapter } from '@/lib/server/adapters/types'
import { safeJsonParse } from '@/lib/server/utils'

/**
 * Trace plumbing for the dispatch pipeline.
 *
 * All of this is built on @opentelemetry/api only — when no SDK is registered
 * (tests, instrumentation disabled) every call goes through the no-op tracer
 * and costs nothing. Spans are exported only when registerOTel ran at startup
 * and OTEL_EXPORTER_OTLP_ENDPOINT is configured.
 */

/**
 * Serializes the active W3C trace context (traceparent/tracestate) for
 * persistence on a TaskStep. Returns null when no trace is active.
 */
export function captureTraceContext(): string | null {
  const carrier: Record<string, string> = {}
  propagation.inject(context.active(), carrier)
  return Object.keys(carrier).length > 0 ? JSON.stringify(carrier) : null
}

const tracer = trace.getTracer('conductor-dispatch')

/**
 * Runs an adapter dispatch inside an OTel span, parented to the trace that
 * created the step (its persisted `traceContext`) when present. Records
 * adapter, model, mode, token usage, and cost; errors are recorded and
 * rethrown untouched.
 */
export async function dispatchWithTelemetry(
  adapter: RuntimeAdapter,
  params: DispatchParams,
  stepTraceContext?: string | null,
): Promise<DispatchResult> {
  const carrier = stepTraceContext
    ? safeJsonParse<Record<string, string>>(stepTraceContext, {})
    : {}
  const parentCtx =
    Object.keys(carrier).length > 0
      ? propagation.extract(context.active(), carrier)
      : context.active()

  return tracer.startActiveSpan(
    `adapter.dispatch ${adapter.id}`,
    {
      attributes: {
        'adapter.id': adapter.id,
        'llm.model': params.model,
        'step.mode': params.mode,
      },
    },
    parentCtx,
    async (span) => {
      try {
        const result = await adapter.dispatch(params)
        if (result.tokensUsed !== undefined) span.setAttribute('llm.tokens_used', result.tokensUsed)
        if (result.cost !== undefined) span.setAttribute('llm.cost_usd', result.cost)
        span.setStatus({ code: SpanStatusCode.OK })
        return result
      } catch (err) {
        if (err instanceof Error) span.recordException(err)
        span.setStatus({
          code: SpanStatusCode.ERROR,
          message: err instanceof Error ? err.message : 'dispatch failed',
        })
        throw err
      } finally {
        span.end()
      }
    },
  )
}
