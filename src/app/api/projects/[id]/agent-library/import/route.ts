import { NextResponse } from 'next/server'

import { db } from '@/lib/db'
import { assertSameOrigin } from '@/lib/csrf'
import { requireAdminSession } from '@/lib/server/admin-session'
import { badRequest, notFound, withErrorHandling } from '@/lib/server/api-errors'
import { importLibrarySchema } from '@/lib/server/contracts'
import { importLibrary } from '@/lib/server/agent-library'

/** POST /api/projects/[id]/agent-library/import — idempotent library import. */
export const POST = withErrorHandling(
  'api/projects/[id]/agent-library/import',
  async (request: Request, { params }: { params: Promise<{ id: string }> }) => {
    const unauthorized = await requireAdminSession()
    if (unauthorized) return unauthorized
    assertSameOrigin(request)

    const { id } = await params
    const project = await db.project.findUnique({ where: { id }, select: { id: true } })
    if (!project) throw notFound('Project not found')

    const parsed = importLibrarySchema.safeParse(await request.json().catch(() => ({})))
    if (!parsed.success) {
      throw badRequest(parsed.error.issues[0]?.message || 'Invalid import payload')
    }

    const result = await importLibrary(id, parsed.data)
    return NextResponse.json(result)
  },
)
