import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireAdminSession } from '@/lib/server/admin-session'
import { updateProjectSchema } from '@/lib/server/contracts'
import { agentSummarySelect } from '@/lib/server/selects'

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const unauthorized = await requireAdminSession()
    if (unauthorized) {
      return unauthorized
    }

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

    if (!project) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 })
    }

    return NextResponse.json(project)
  } catch (error) {
    console.error('Error fetching project:', error)
    return NextResponse.json({ error: 'Failed to fetch project' }, { status: 500 })
  }
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const unauthorized = await requireAdminSession()
    if (unauthorized) {
      return unauthorized
    }

    const { id } = await params
    const parsed = updateProjectSchema.safeParse(await request.json())
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0]?.message || 'Invalid project payload' }, { status: 400 })
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
  } catch (error) {
    console.error('Error updating project:', error)
    return NextResponse.json({ error: 'Failed to update project' }, { status: 500 })
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const unauthorized = await requireAdminSession()
    if (unauthorized) {
      return unauthorized
    }

    const { id } = await params
    await db.project.delete({
      where: { id },
    })

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Error deleting project:', error)
    return NextResponse.json({ error: 'Failed to delete project' }, { status: 500 })
  }
}
