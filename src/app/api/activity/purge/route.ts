import { NextResponse } from 'next/server'
import { z } from 'zod'

import { requireAdminSession } from '@/lib/server/admin-session'
import { badRequest, withErrorHandling } from '@/lib/server/api-errors'
import { purgeOldLogs } from '@/lib/server/activity-logger'

const purgeSchema = z.object({
  projectId: z.string().trim().min(1),
  retentionDays: z.number().int().min(1).max(3650),
})

export const POST = withErrorHandling('api/activity/purge', async (request: Request) => {
  const unauthorized = await requireAdminSession()
  if (unauthorized) return unauthorized

  const body = await request.json().catch(() => null)
  const parsed = purgeSchema.safeParse(body)
  if (!parsed.success) {
    throw badRequest(parsed.error.issues[0]?.message || 'Invalid purge request')
  }

  const { projectId, retentionDays } = parsed.data
  const deleted = await purgeOldLogs(projectId, retentionDays)

  return NextResponse.json({ deleted })
})
