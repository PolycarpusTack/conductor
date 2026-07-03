import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { assertSameOrigin } from '@/lib/csrf'
import { requireAdminSession, requireRole } from '@/lib/server/admin-session'
import { badRequest, notFound, withErrorHandling } from '@/lib/server/api-errors'
import { getMonthToDateSpend } from '@/lib/server/budget'
import { updateProjectSchema } from '@/lib/server/contracts'
import { agentSummarySelect } from '@/lib/server/selects'

export const GET = withErrorHandling(
  'api/projects/[id]',
  async (request: Request, { params }: { params: Promise<{ id: string }> }) => {
    const unauthorized = await requireAdminSession()
    if (unauthorized) return unauthorized

    const { id } = await params
    const project = await db.project.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
        description: true,
        color: true,
        defaultStepMode: true,
        defaultChainTemplateId: true,
        artifactRetentionDays: true,
        budgetUsd: true,
        agents: {
          select: agentSummarySelect,
        },
        tasks: {
          where: { deletedAt: null, archivedAt: null },
          include: {
            agent: {
              select: agentSummarySelect,
            },
            steps: {
              select: {
                id: true,
                order: true,
                mode: true,
                status: true,
                agentId: true,
                humanLabel: true,
                autoContinue: true,
                agent: { select: { id: true, name: true, emoji: true } },
              },
              orderBy: { order: 'asc' as const },
            },
          },
          orderBy: { order: 'asc' },
        },
      },
    })

    if (!project) throw notFound('Project not found')

    // B-7: the board header needs the budget state. Spend is only computed
    // when a budget is set — the no-budget path stays exactly as before
    // (the nullable column is the feature flag).
    const spentThisMonthUsd =
      project.budgetUsd != null ? await getMonthToDateSpend(id) : null

    return NextResponse.json({
      ...project,
      spentThisMonthUsd,
      budgetPaused:
        project.budgetUsd != null && (spentThisMonthUsd ?? 0) >= project.budgetUsd,
    })
  },
)

export const PUT = withErrorHandling(
  'api/projects/[id]',
  async (request: Request, { params }: { params: Promise<{ id: string }> }) => {
    const unauthorized = await requireAdminSession()
    if (unauthorized) return unauthorized
    assertSameOrigin(request)

    const { id } = await params
    const parsed = updateProjectSchema.safeParse(await request.json())
    if (!parsed.success) {
      throw badRequest(parsed.error.issues[0]?.message || 'Invalid project payload')
    }
    const {
      name, description, color, logRetentionDays,
      defaultStepMode, defaultChainTemplateId, artifactRetentionDays,
      autoArchiveDays, reviewEscalationHours, budgetUsd,
    } = parsed.data

    const project = await db.project.update({
      where: { id },
      data: {
        name, description, color, logRetentionDays,
        defaultStepMode, defaultChainTemplateId, artifactRetentionDays,
        autoArchiveDays, reviewEscalationHours, budgetUsd,
      },
      select: {
        id: true,
        name: true,
        description: true,
        color: true,
        defaultStepMode: true,
        defaultChainTemplateId: true,
        artifactRetentionDays: true,
        autoArchiveDays: true,
        reviewEscalationHours: true,
        budgetUsd: true,
      },
    })

    return NextResponse.json(project)
  },
)

export const DELETE = withErrorHandling(
  'api/projects/[id]',
  async (request: Request, { params }: { params: Promise<{ id: string }> }) => {
    // Destroying a project (and everything in it) is admin-only territory.
    const unauthorized = await requireRole('admin')
    if (unauthorized) return unauthorized
    assertSameOrigin(request)

    const { id } = await params
    await db.project.delete({ where: { id } })

    return NextResponse.json({ success: true })
  },
)
