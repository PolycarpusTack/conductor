import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireAdminSession } from '@/lib/server/admin-session'
import { createProjectModeSchema } from '@/lib/server/contracts'
import { ensureProjectModes } from '@/lib/server/default-modes'

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const unauthorized = await requireAdminSession()
    if (unauthorized) return unauthorized

    const { id } = await params
    await ensureProjectModes(id)

    const modes = await db.projectMode.findMany({
      where: { projectId: id },
      orderBy: { createdAt: 'asc' },
    })

    return NextResponse.json(modes)
  } catch (error) {
    console.error('Error fetching modes:', error)
    return NextResponse.json({ error: 'Failed to fetch modes' }, { status: 500 })
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const unauthorized = await requireAdminSession()
    if (unauthorized) return unauthorized

    const { id } = await params
    const parsed = createProjectModeSchema.safeParse(await request.json())
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message || 'Invalid mode payload' },
        { status: 400 },
      )
    }

    const mode = await db.projectMode.create({
      data: { ...parsed.data, projectId: id },
    })

    return NextResponse.json(mode)
  } catch (error) {
    console.error('Error creating mode:', error)
    return NextResponse.json({ error: 'Failed to create mode' }, { status: 500 })
  }
}
