import { NextResponse } from 'next/server'
import { z } from 'zod'
import { assertSameOrigin } from '@/lib/csrf'
import { requireAdminSession } from '@/lib/server/admin-session'
import { getLogger } from '@/lib/server/logger'
import { composeAgent } from '@/lib/server/wizard-composer'
import { validateLibraryPath } from '@/lib/server/prompt-library'

const log = getLogger('api/agent-wizard/compose')

const composeRequestSchema = z.object({
  purpose:   z.string().trim().min(10),
  domain:    z.string().trim().min(1),
  goal:      z.string().trim().min(1),
  runtimeId: z.string().trim().min(1),
})

/** POST /api/agent-wizard/compose — searches archive and calls LLM to compose agent fields */
export async function POST(req: Request) {
  const unauthorized = await requireAdminSession()
  if (unauthorized) return unauthorized

  // This route is not wrapped in withErrorHandling, so map the CSRF error manually
  try {
    assertSameOrigin(req)
  } catch {
    return NextResponse.json({ error: 'Cross-origin request blocked' }, { status: 403 })
  }

  const libraryError = validateLibraryPath()
  if (libraryError) {
    return NextResponse.json({ error: libraryError }, { status: 503 })
  }

  const body = await req.json().catch(() => null)
  const parsed = composeRequestSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })
  }

  try {
    const result = await composeAgent(parsed.data)
    return NextResponse.json(result)
  } catch (err: unknown) {
    const e = err as Error & { rawResponse?: string }
    if (e.message === 'LLM_PARSE_FAILURE') {
      return NextResponse.json(
        { error: 'LLM returned unparseable response', rawResponse: e.rawResponse },
        { status: 422 },
      )
    }
    if (e.message.startsWith('Runtime not found')) {
      return NextResponse.json({ error: e.message }, { status: 404 })
    }
    log.error('compose failed', e)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
