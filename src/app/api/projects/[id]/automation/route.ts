import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireAdminSession } from '@/lib/server/admin-session'
import {
  startProjectAutomation,
  stopProjectAutomation,
  manualStartAutomation,
  isProjectRunning,
} from '@/lib/server/scheduler'

// GET — get automation status and config
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const unauthorized = await requireAdminSession()
    if (unauthorized) return unauthorized

    const { id } = await params
    const project = await db.project.findUnique({
      where: { id },
      select: {
        automationMode: true,
        automationSchedule: true,
        automationPollMs: true,
      },
    })

    if (!project) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 })
    }

    return NextResponse.json({
      ...project,
      automationSchedule: project.automationSchedule
        ? (() => { try { return JSON.parse(project.automationSchedule!) } catch { return null } })()
        : null,
      running: isProjectRunning(id),
    })
  } catch (error) {
    console.error('Error fetching automation config:', error)
    return NextResponse.json({ error: 'Failed to fetch automation config' }, { status: 500 })
  }
}

// PUT — update automation config and apply
export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const unauthorized = await requireAdminSession()
    if (unauthorized) return unauthorized

    const { id } = await params
    const body = await request.json()

    const validModes = ['manual', 'always', 'scheduled', 'startup']
    if (body.mode && !validModes.includes(body.mode)) {
      return NextResponse.json(
        { error: `Invalid mode. Use: ${validModes.join(', ')}` },
        { status: 400 },
      )
    }

    const updateData: Record<string, unknown> = {}

    if (body.mode !== undefined) {
      updateData.automationMode = body.mode
    }
    if (body.schedule !== undefined) {
      updateData.automationSchedule = body.schedule
        ? JSON.stringify(body.schedule)
        : null
    }
    if (body.pollMs !== undefined) {
      const pollMs = Math.max(3000, Math.min(300000, Number(body.pollMs) || 10000))
      updateData.automationPollMs = pollMs
    }

    await db.project.update({
      where: { id },
      data: updateData,
    })

    // Apply the new config immediately
    stopProjectAutomation(id)
    await startProjectAutomation(id)

    return NextResponse.json({
      success: true,
      running: isProjectRunning(id),
    })
  } catch (error) {
    console.error('Error updating automation config:', error)
    return NextResponse.json({ error: 'Failed to update automation config' }, { status: 500 })
  }
}

// POST — manual start/stop control
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const unauthorized = await requireAdminSession()
    if (unauthorized) return unauthorized

    const { id } = await params
    const body = await request.json()

    if (body.action === 'start') {
      const project = await db.project.findUnique({
        where: { id },
        select: { automationPollMs: true },
      })
      if (!project) {
        return NextResponse.json({ error: 'Project not found' }, { status: 404 })
      }
      manualStartAutomation(id, project.automationPollMs || 10000)
      return NextResponse.json({ success: true, running: true })
    }

    if (body.action === 'stop') {
      const project = await db.project.findUnique({
        where: { id },
        select: { id: true },
      })
      if (!project) {
        return NextResponse.json({ error: 'Project not found' }, { status: 404 })
      }
      stopProjectAutomation(id)
      return NextResponse.json({ success: true, running: false })
    }

    return NextResponse.json({ error: 'Invalid action. Use: start, stop' }, { status: 400 })
  } catch (error) {
    console.error('Error controlling automation:', error)
    return NextResponse.json({ error: 'Failed to control automation' }, { status: 500 })
  }
}
