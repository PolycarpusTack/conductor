import { NextResponse } from 'next/server'

import { requireAdminSession } from '@/lib/server/admin-session'
import { notFound, withErrorHandling } from '@/lib/server/api-errors'
import { assembleStepEvidence } from '@/lib/server/evidence'

/** GET /api/tasks/[id]/steps/[stepId]/evidence — the step's evidence packet. */
export const GET = withErrorHandling(
  'api/tasks/[id]/steps/[stepId]/evidence',
  async (_req: Request, { params }: { params: Promise<{ id: string; stepId: string }> }) => {
    const unauthorized = await requireAdminSession()
    if (unauthorized) return unauthorized

    const { id, stepId } = await params
    const packet = await assembleStepEvidence(id, stepId)
    if (!packet) throw notFound('Step not found')

    return NextResponse.json(packet)
  },
)
