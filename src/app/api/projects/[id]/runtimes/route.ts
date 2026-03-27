import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireAdminSession } from '@/lib/server/admin-session'
import { createProjectRuntimeSchema } from '@/lib/server/contracts'

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const unauthorized = await requireAdminSession()
    if (unauthorized) return unauthorized

    const { id } = await params

    const runtimes = await db.projectRuntime.findMany({
      where: { projectId: id },
      orderBy: { createdAt: 'asc' },
    })

    return NextResponse.json(runtimes)
  } catch (error) {
    console.error('Error fetching runtimes:', error)
    return NextResponse.json({ error: 'Failed to fetch runtimes' }, { status: 500 })
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
    const parsed = createProjectRuntimeSchema.safeParse(await request.json())
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message || 'Invalid runtime payload' },
        { status: 400 },
      )
    }

    const runtime = await db.projectRuntime.create({
      data: {
        ...parsed.data,
        models: JSON.stringify(parsed.data.models),
        config: parsed.data.config ? JSON.stringify(parsed.data.config) : null,
        projectId: id,
      },
    })

    return NextResponse.json(runtime)
  } catch (error) {
    console.error('Error creating runtime:', error)
    return NextResponse.json({ error: 'Failed to create runtime' }, { status: 500 })
  }
}
