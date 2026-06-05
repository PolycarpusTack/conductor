import { NextResponse } from 'next/server'

import { db } from '@/lib/db'
import { requireAdminSession } from '@/lib/server/admin-session'
import { notFound, withErrorHandling } from '@/lib/server/api-errors'
import { getAdapter } from '@/lib/server/adapters/registry'
import { safeJsonParse } from '@/lib/server/utils'

/**
 * GET /api/admin/runtimes/[id]/health — fires a minimal echo prompt through
 * the runtime's adapter and reports reachability + latency. Costs one tiny
 * LLM call, so it is admin-triggered, never polled automatically.
 */
export const GET = withErrorHandling(
  'api/admin/runtimes/[id]/health',
  async (_req: Request, { params }: { params: Promise<{ id: string }> }) => {
    const unauthorized = await requireAdminSession()
    if (unauthorized) return unauthorized

    const { id } = await params
    const runtime = await db.projectRuntime.findUnique({ where: { id } })
    if (!runtime) throw notFound('Runtime not found')

    const adapter = getAdapter(runtime.adapter)
    if (!adapter || !adapter.available) {
      return NextResponse.json(
        {
          status: 'unavailable',
          adapter: runtime.adapter,
          model: null,
          latencyMs: null,
          error: `Adapter "${runtime.adapter}" is not available`,
        },
        { status: 503 },
      )
    }

    // `models` is a JSON array of { id, name, tier? } objects
    const models = safeJsonParse<Array<{ id?: string }>>(runtime.models, [])
    const model = models[0]?.id ?? 'default'

    const runtimeConfig: Record<string, unknown> = {
      ...safeJsonParse<Record<string, unknown>>(runtime.config, {}),
      apiKeyEnvVar: runtime.apiKeyEnvVar,
      endpoint: runtime.endpoint,
    }

    const start = Date.now()
    try {
      await adapter.dispatch({
        systemPrompt: 'You are a health check. Reply with only "ok".',
        taskContext: 'health check',
        mode: 'analyze',
        model,
        runtimeConfig,
      })
      return NextResponse.json({
        status: 'ok',
        adapter: runtime.adapter,
        model,
        latencyMs: Date.now() - start,
      })
    } catch (err) {
      return NextResponse.json(
        {
          status: 'error',
          adapter: runtime.adapter,
          model,
          latencyMs: Date.now() - start,
          error: err instanceof Error ? err.message : 'Unknown error',
        },
        { status: 502 },
      )
    }
  },
)
