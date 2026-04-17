import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireAdminSession } from '@/lib/server/admin-session'
import { badRequest, notFound, withErrorHandling } from '@/lib/server/api-errors'
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
        agents: {
          select: agentSummarySelect,
        },
        tasks: {
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

    return NextResponse.json(project)
  },
)

export const PUT = withErrorHandling(
  'api/projects/[id]',
  async (request: Request, { params }: { params: Promise<{ id: string }> }) => {
    const unauthorized = await requireAdminSession()
    if (unauthorized) return unauthorized

    const { id } = await params
    const parsed = updateProjectSchema.safeParse(await request.json())
    if (!parsed.success) {
      throw badRequest(parsed.error.issues[0]?.message || 'Invalid project payload')
    }
    const { name, description, color } = parsed.data

    const project = await db.project.update({
      where: { id },
      data: { name, description, color },
      select: {
        id: true,
        name: true,
        description: true,
        color: true,
      },
    })

    return NextResponse.json(project)
  },
)

export const DELETE = withErrorHandling(
  'api/projects/[id]',
  async (request: Request, { params }: { params: Promise<{ id: string }> }) => {
    const unauthorized = await requireAdminSession()
    if (unauthorized) return unauthorized

    const { id } = await params
    await db.project.delete({ where: { id } })

    return NextResponse.json({ success: true })
  },
)
