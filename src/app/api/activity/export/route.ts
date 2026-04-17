import { db } from '@/lib/db'
import { requireAdminSession } from '@/lib/server/admin-session'
import { badRequest, withErrorHandling } from '@/lib/server/api-errors'

export const GET = withErrorHandling('api/activity/export', async (request: Request) => {
    const unauthorized = await requireAdminSession()
    if (unauthorized) return unauthorized

    const { searchParams } = new URL(request.url)
    const projectId = searchParams.get('projectId')
    const format = searchParams.get('format') || 'jsonl'
    const from = searchParams.get('from')
    const to = searchParams.get('to')
    const limit = Math.min(parseInt(searchParams.get('limit') || '10000', 10) || 10000, 50000)

    if (!projectId) throw badRequest('projectId is required')

    const where: Record<string, unknown> = { projectId }
    if (from || to) {
      const createdAt: Record<string, Date> = {}
      if (from) createdAt.gte = new Date(from)
      if (to) createdAt.lte = new Date(to)
      where.createdAt = createdAt
    }

    const activities = await db.activityLog.findMany({
      where,
      include: {
        agent: { select: { name: true, emoji: true } },
      },
      orderBy: { createdAt: 'asc' },
      take: limit,
    })

    if (format === 'csv') {
      const header = 'id,action,taskId,agentId,agentName,projectId,details,createdAt'
      const rows = activities.map((a) => {
        const details = (a.details || '').replace(/"/g, '""')
        const agentName = a.agent?.name || ''
        return `"${a.id}","${a.action}","${a.taskId || ''}","${a.agentId || ''}","${agentName}","${a.projectId}","${details}","${a.createdAt.toISOString()}"`
      })
      const csv = [header, ...rows].join('\n')

      return new Response(csv, {
        headers: {
          'Content-Type': 'text/csv',
          'Content-Disposition': `attachment; filename="activity-${projectId}-${new Date().toISOString().slice(0, 10)}.csv"`,
        },
      })
    }

    // Default: JSONL
    const lines = activities.map((a) => JSON.stringify({
      id: a.id,
      action: a.action,
      taskId: a.taskId,
      agentId: a.agentId,
      agentName: a.agent?.name || null,
      agentEmoji: a.agent?.emoji || null,
      projectId: a.projectId,
      details: a.details,
      createdAt: a.createdAt.toISOString(),
    }))
    const jsonl = lines.join('\n') + '\n'

    return new Response(jsonl, {
      headers: {
        'Content-Type': 'application/x-ndjson',
        'Content-Disposition': `attachment; filename="activity-${projectId}-${new Date().toISOString().slice(0, 10)}.jsonl"`,
      },
    })
})
