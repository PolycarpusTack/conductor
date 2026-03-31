import { NextResponse } from 'next/server'

import { db } from '@/lib/db'
import { extractAgentApiKey, resolveAgentByApiKey } from '@/lib/server/api-keys'
import { updateAgentHeartbeat, toRealtimeActivity, claimOrStartTask } from '@/lib/server/agent-helpers'
import { agentTaskActionSchema, taskStatusSchema, stepArtifactSchema } from '@/lib/server/contracts'
import { advanceChain } from '@/lib/server/dispatch'
import { broadcastProjectEvent } from '@/lib/server/realtime'
import { taskBoardInclude } from '@/lib/server/selects'

async function getAgentFromRequest(request: Request, body?: Record<string, unknown>) {
  const apiKey = extractAgentApiKey(request, body)

  if (!apiKey) {
    return {
      error: NextResponse.json(
        {
          error: 'Missing agent API key',
          hint: 'Use Authorization: Bearer <agent-key> or X-Agent-Key header',
        },
        { status: 401 },
      ),
    }
  }

  const agent = await resolveAgentByApiKey(apiKey)
  if (!agent) {
    return { error: NextResponse.json({ error: 'Invalid API key' }, { status: 401 }) }
  }

  return { agent }
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const auth = await getAgentFromRequest(request)
    if (auth.error) {
      return auth.error
    }

    const agent = auth.agent!
    const { id } = await params

    const task = await db.task.findUnique({
      where: { id },
      include: taskBoardInclude,
    })

    if (!task) {
      return NextResponse.json({ error: 'Task not found' }, { status: 404 })
    }

    if (task.projectId !== agent.projectId) {
      return NextResponse.json({ error: 'Task not in your project' }, { status: 403 })
    }

    await updateAgentHeartbeat(agent.id)
    return NextResponse.json(task)
  } catch (error) {
    console.error('Error fetching task:', error)
    return NextResponse.json({ error: 'Failed to fetch task' }, { status: 500 })
  }
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const body = await request.json()
    const auth = await getAgentFromRequest(request, body)
    if (auth.error) {
      return auth.error
    }

    const agent = auth.agent!
    const { id } = await params
    const existingTask = await db.task.findUnique({
      where: { id },
      include: { steps: { select: { id: true, status: true, order: true, agentId: true } } }
    })

    if (!existingTask) {
      return NextResponse.json({ error: 'Task not found' }, { status: 404 })
    }

    if (existingTask.projectId !== agent.projectId) {
      return NextResponse.json({ error: 'Task not in your project' }, { status: 403 })
    }

    const actionResult =
      body.action === undefined ? { success: true, data: undefined } : agentTaskActionSchema.safeParse(body.action)
    if (!actionResult.success) {
      return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
    }

    const MAX_FIELD_LENGTH = 5000
    const rawNotes = typeof body.notes === 'string' ? body.notes : undefined
    const rawOutput = typeof body.output === 'string' ? body.output : undefined
    const notesTruncated = rawNotes !== undefined && rawNotes.length > MAX_FIELD_LENGTH
    const outputTruncated = rawOutput !== undefined && rawOutput.length > MAX_FIELD_LENGTH
    const notes = rawNotes?.slice(0, MAX_FIELD_LENGTH)
    const output = rawOutput?.slice(0, MAX_FIELD_LENGTH)
    const explicitStatus =
      body.status === undefined ? { success: true, data: undefined } : taskStatusSchema.safeParse(body.status)

    if (!explicitStatus.success) {
      return NextResponse.json({ error: 'Invalid task status' }, { status: 400 })
    }

    let updateData: Record<string, unknown> = {}
    let logAction = 'updated'
    let logDetails = ''

    switch (actionResult.data) {
      case 'claim':
      case 'start': {
        const actionName = actionResult.data === 'claim' ? 'claimed' : 'started'
        const result = await claimOrStartTask(id, agent, actionName)
        if ('error' in result) {
          return NextResponse.json({ error: result.error }, { status: result.status })
        }
        return NextResponse.json({ success: true, task: result.task, action: actionName })
      }

      case 'progress':
        if (existingTask.agentId !== agent.id) {
          return NextResponse.json({ error: 'Task is not assigned to this agent' }, { status: 403 })
        }
        updateData = { notes: notes || existingTask.notes }
        logAction = 'progress'
        logDetails = notes || ''
        break

      case 'complete':
        if (existingTask.agentId !== agent.id) {
          return NextResponse.json({ error: 'Task is not assigned to this agent' }, { status: 403 })
        }
        // For chained tasks, don't set DONE — let advanceChain handle it
        updateData = {
          output: output || existingTask.output,
        }
        // Only set DONE for non-chained tasks
        if (!existingTask.steps || existingTask.steps.length === 0) {
          updateData.status = 'DONE'
          updateData.completedAt = new Date()
        }
        logAction = 'completed'
        logDetails = output || ''
        break

      case 'review':
        if (existingTask.agentId !== agent.id) {
          return NextResponse.json({ error: 'Task is not assigned to this agent' }, { status: 403 })
        }
        updateData = {
          status: 'REVIEW',
          output: output || existingTask.output,
        }
        logAction = 'moved_to_review'
        logDetails = output || ''
        break

      case 'block':
        if (existingTask.agentId !== agent.id) {
          return NextResponse.json({ error: 'Task is not assigned to this agent' }, { status: 403 })
        }
        updateData = {
          notes: `BLOCKED: ${notes || existingTask.notes || ''}`.trim(),
        }
        logAction = 'blocked'
        logDetails = notes || ''
        break

      default:
        if (existingTask.agentId && existingTask.agentId !== agent.id) {
          return NextResponse.json({ error: 'Task is not assigned to this agent' }, { status: 403 })
        }

        // Agents can only update notes/output in the default branch — not status.
        // Status changes must go through explicit actions (claim, start, complete, review, block).
        if (explicitStatus.data !== undefined) {
          return NextResponse.json(
            { error: 'Use an explicit action (claim, start, complete, review, block) to change task status' },
            { status: 400 },
          )
        }

        updateData = {
          ...(!existingTask.agentId && { agentId: agent.id }),
          ...(notes !== undefined && { notes }),
          ...(output !== undefined && { output }),
        }
    }

    const task = await db.task.update({
      where: { id },
      data: updateData,
      include: taskBoardInclude,
    })

    await db.activityLog.create({
      data: {
        action: logAction,
        taskId: task.id,
        agentId: agent.id,
        projectId: agent.projectId,
        details: logDetails,
      },
    })

    const taskEvent =
      task.status !== existingTask.status
        ? ['task-moved', { taskId: task.id, task }] as const
        : ['task-updated', task] as const

    await broadcastProjectEvent(agent.projectId, taskEvent[0], taskEvent[1])
    await broadcastProjectEvent(agent.projectId, 'agent-status', {
      agentId: agent.id,
      isActive: true,
    })
    await broadcastProjectEvent(
      agent.projectId,
      'agent-activity',
      toRealtimeActivity({
        action: logAction,
        agent,
        details: logDetails,
        taskId: task.id,
      }),
    )
    await updateAgentHeartbeat(agent.id)

    if (task.steps && task.steps.length > 0 && (actionResult.data === 'complete' || actionResult.data === 'progress')) {
      const requestedStepId = typeof body.step_id === 'string' ? body.step_id : null

      // If step_id is provided, use it directly. Otherwise, find active steps
      // for this agent — but reject if ambiguous (multiple active branches).
      let activeStep: (typeof task.steps)[number] | null = null
      if (requestedStepId) {
        activeStep = task.steps.find((s: any) => s.id === requestedStepId && s.status === 'active') || null
      } else {
        const agentActiveSteps = task.steps.filter((s: any) => s.status === 'active' && s.agentId === agent.id)
        if (agentActiveSteps.length > 1) {
          return NextResponse.json({
            error: 'Multiple active steps for this agent. Provide step_id to disambiguate.',
            activeSteps: agentActiveSteps.map((s: any) => ({ id: s.id, order: s.order })),
          }, { status: 409 })
        }
        activeStep = agentActiveSteps[0]
          || task.steps.find((s: any) => s.status === 'active' && (!s.agentId || s.agentId === agent.id))
          || null
      }
      if (activeStep && (!activeStep.agentId || activeStep.agentId === agent.id) && actionResult.data === 'complete') {
        // Atomically mark the step as done only if still active (prevents double-completion)
        const completed = await db.taskStep.updateMany({
          where: { id: activeStep.id, status: 'active' },
          data: { status: 'done', output: output || logDetails || '', completedAt: new Date() },
        })

        if (completed.count > 0) {
          // Save artifacts if provided
          if (Array.isArray(body.artifacts)) {
            for (const raw of body.artifacts) {
              const parsed = stepArtifactSchema.safeParse(raw)
              if (parsed.success) {
                await db.stepArtifact.create({
                  data: {
                    stepId: activeStep.id,
                    type: parsed.data.type,
                    label: parsed.data.label,
                    content: parsed.data.content || null,
                    url: parsed.data.url || null,
                    mimeType: parsed.data.mimeType || null,
                    metadata: parsed.data.metadata ? JSON.stringify(parsed.data.metadata) : null,
                  },
                })
              }
            }
          }

          try {
            await advanceChain(id, agent.projectId, activeStep.id)
          } catch (chainErr) {
            console.error('advanceChain failed after step completion:', chainErr)
            await db.task.update({
              where: { id },
              data: { status: 'WAITING' },
            }).catch(console.error)
          }
        }
      }
    }

    return NextResponse.json({
      success: true,
      task,
      action: logAction,
      ...(notesTruncated && { notesTruncated: true }),
      ...(outputTruncated && { outputTruncated: true }),
    })
  } catch (error) {
    console.error('Error updating task:', error)
    return NextResponse.json({ error: 'Failed to update task' }, { status: 500 })
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const auth = await getAgentFromRequest(request)
    if (auth.error) {
      return auth.error
    }

    const agent = auth.agent!
    const { id } = await params
    const task = await db.task.findUnique({ where: { id } })

    if (!task) {
      return NextResponse.json({ error: 'Task not found' }, { status: 404 })
    }

    if (task.projectId !== agent.projectId) {
      return NextResponse.json({ error: 'Task not in your project' }, { status: 403 })
    }

    if (task.agentId !== agent.id) {
      return NextResponse.json({ error: 'Task is not assigned to this agent' }, { status: 403 })
    }

    const updatedTask = await db.task.update({
      where: { id },
      data: { agentId: null, status: 'BACKLOG' },
    })

    await db.activityLog.create({
      data: {
        action: 'unassigned',
        taskId: task.id,
        agentId: agent.id,
        projectId: agent.projectId,
        details: `Unassigned by ${agent.name}`,
      },
    })

    await broadcastProjectEvent(agent.projectId, 'task-moved', {
      taskId: task.id,
      task: updatedTask,
    })
    await broadcastProjectEvent(agent.projectId, 'agent-activity', toRealtimeActivity({
      action: 'unassigned',
      agent,
      details: `Unassigned by ${agent.name}`,
      taskId: task.id,
    }))
    await updateAgentHeartbeat(agent.id)

    return NextResponse.json({ success: true, task: updatedTask })
  } catch (error) {
    console.error('Error unassigning task:', error)
    return NextResponse.json({ error: 'Failed to unassign task' }, { status: 500 })
  }
}
