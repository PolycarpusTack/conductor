import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireAdminSession } from '@/lib/server/admin-session'
import { badRequest, notFound, withErrorHandling } from '@/lib/server/api-errors'
import {
  startProjectAutomation,
  stopProjectAutomation,
  manualStartAutomation,
  isProjectRunning,
} from '@/lib/server/scheduler'

// GET — get automation status and config
export const GET = withErrorHandling(
  'api/projects/[id]/automation',
  async (request: Request, { params }: { params: Promise<{ id: string }> }) => {
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

    if (!project) throw notFound('Project not found')

    return NextResponse.json({
      ...project,
      automationSchedule: project.automationSchedule
        ? (() => { try { return JSON.parse(project.automationSchedule!) } catch { return null } })()
        : null,
      running: isProjectRunning(id),
    })
  },
)

// PUT — update automation config and apply
export const PUT = withErrorHandling(
  'api/projects/[id]/automation',
  async (request: Request, { params }: { params: Promise<{ id: string }> }) => {
    const unauthorized = await requireAdminSession()
    if (unauthorized) return unauthorized

    const { id } = await params
    const body = await request.json()

    const validModes = ['manual', 'always', 'scheduled', 'startup']
    if (body.mode && !validModes.includes(body.mode)) {
      throw badRequest(`Invalid mode. Use: ${validModes.join(', ')}`)
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
  },
)

// POST — manual start/stop control
export const POST = withErrorHandling(
  'api/projects/[id]/automation',
  async (request: Request, { params }: { params: Promise<{ id: string }> }) => {
    const unauthorized = await requireAdminSession()
    if (unauthorized) return unauthorized

    const { id } = await params
    const body = await request.json()

    if (body.action === 'start') {
      const project = await db.project.findUnique({
        where: { id },
        select: { automationPollMs: true },
      })
      if (!project) throw notFound('Project not found')
      manualStartAutomation(id, project.automationPollMs || 10000)
      return NextResponse.json({ success: true, running: true })
    }

    if (body.action === 'stop') {
      const project = await db.project.findUnique({
        where: { id },
        select: { id: true },
      })
      if (!project) throw notFound('Project not found')
      stopProjectAutomation(id)
      return NextResponse.json({ success: true, running: false })
    }

    throw badRequest('Invalid action. Use: start, stop')
  },
)
