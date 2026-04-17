import { NextResponse } from 'next/server'

import { requireAdminSession } from '@/lib/server/admin-session'
import { withErrorHandling } from '@/lib/server/api-errors'
import { backfillProjectWorkspaces } from '@/lib/server/workspace'

export const POST = withErrorHandling('api/workspaces/backfill', async () => {
  const unauthorized = await requireAdminSession()
  if (unauthorized) return unauthorized

  const count = await backfillProjectWorkspaces()

  return NextResponse.json({
    backfilled: count,
    message: count > 0
      ? `Assigned ${count} project(s) to the default workspace.`
      : 'All projects already have a workspace.',
  })
})
