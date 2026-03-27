import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireAdminSession } from '@/lib/server/admin-session'
import { createChainTemplateSchema } from '@/lib/server/contracts'

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const unauthorized = await requireAdminSession()
    if (unauthorized) return unauthorized

    const { id } = await params

    const templates = await db.chainTemplate.findMany({
      where: { projectId: id },
      orderBy: { createdAt: 'asc' },
    })

    return NextResponse.json(templates)
  } catch (error) {
    console.error('Error fetching chain templates:', error)
    return NextResponse.json({ error: 'Failed to fetch chain templates' }, { status: 500 })
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
    const parsed = createChainTemplateSchema.safeParse(await request.json())
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message || 'Invalid chain template payload' },
        { status: 400 },
      )
    }

    const template = await db.chainTemplate.create({
      data: {
        ...parsed.data,
        steps: JSON.stringify(parsed.data.steps),
        projectId: id,
      },
    })

    return NextResponse.json(template)
  } catch (error) {
    console.error('Error creating chain template:', error)
    return NextResponse.json({ error: 'Failed to create chain template' }, { status: 500 })
  }
}
