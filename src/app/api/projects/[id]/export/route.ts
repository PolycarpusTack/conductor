import { NextResponse } from 'next/server'

import { assertKeyProjectAccess, authorizeAdminOrScopedKey } from '@/lib/server/api-auth'
import { withErrorHandling } from '@/lib/server/api-errors'
import { buildProjectExport } from '@/lib/server/project-export'

/**
 * GET /api/projects/[id]/export — download a project as a secret-free JSON
 * bundle (tasks + steps, agents/modes/runtimes/chain templates, no keys).
 * Admin session OR a scoped "read" key bound to this project.
 */
export const GET = withErrorHandling(
  'api/projects/[id]/export',
  async (request: Request, { params }: { params: Promise<{ id: string }> }) => {
    const auth = await authorizeAdminOrScopedKey(request, 'read')
    if (!auth.ok) return auth.response

    const { id } = await params
    assertKeyProjectAccess(auth, id)

    const bundle = await buildProjectExport(id)

    return NextResponse.json(bundle, {
      headers: {
        'Content-Disposition': `attachment; filename="project-${id}-export.json"`,
      },
    })
  },
)
