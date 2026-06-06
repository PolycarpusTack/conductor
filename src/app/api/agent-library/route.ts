import { NextResponse } from 'next/server'

import { requireAdminSession } from '@/lib/server/admin-session'
import { withErrorHandling } from '@/lib/server/api-errors'
import { getLibrarySummary } from '@/lib/server/agent-library'

/** GET /api/agent-library — bundled library catalog for the browse/import UI. */
export const GET = withErrorHandling('api/agent-library', async () => {
  const unauthorized = await requireAdminSession()
  if (unauthorized) return unauthorized

  return NextResponse.json(getLibrarySummary())
})
