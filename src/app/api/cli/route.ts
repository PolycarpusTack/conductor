import { db } from '@/lib/db'
import { extractAgentApiKey, resolveAgentByApiKey } from '@/lib/server/api-keys'
import { updateAgentHeartbeat, toRealtimeActivity, claimOrStartTask } from '@/lib/server/agent-helpers'
import { cliActionSchema } from '@/lib/server/contracts'
import { advanceChain } from '@/lib/server/dispatch'
import { broadcastProjectEvent } from '@/lib/server/realtime'
import { taskBoardInclude } from '@/lib/server/selects'

export async function GET(request: Request) {
  try {
    const apiKey = extractAgentApiKey(request)

    if (!apiKey) {
      return new Response(
        'ERROR: Missing agent API key\nUse Authorization: Bearer YOUR_KEY or X-Agent-Key header',
        { status: 401 },
      )
    }

    const agent = await resolveAgentByApiKey(apiKey)

    if (!agent) {
      return new Response('ERROR: Invalid API key', { status: 401 })
    }

    await updateAgentHeartbeat(agent.id)
    broadcastProjectEvent(agent.projectId, 'agent-status', {
      agentId: agent.id,
      isActive: true,
    })

    const inProgressTask = await db.task.findFirst({
      where: {
        projectId: agent.projectId,
        agentId: agent.id,
        status: 'IN_PROGRESS',
      },
      orderBy: [{ priority: 'desc' }, { order: 'asc' }],
    })

    const assignedBacklogTask =
      inProgressTask ||
      (await db.task.findFirst({
        where: {
          projectId: agent.projectId,
          agentId: agent.id,
          status: 'BACKLOG',
        },
        orderBy: [{ priority: 'desc' }, { order: 'asc' }],
      }))

    const task =
      assignedBacklogTask ||
      (await db.task.findFirst({
        where: {
          projectId: agent.projectId,
          agentId: null,
          status: 'BACKLOG',
        },
        orderBy: [{ priority: 'desc' }, { order: 'asc' }],
      }))

    if (!task) {
      return new Response('NO_TASKS: No tasks available\n')
    }

    const statusIcon = task.status === 'IN_PROGRESS' ? '🔄' : '📋'
    const priorityIcon = { URGENT: '🔴', HIGH: '🟠', MEDIUM: '🟡', LOW: '⚪' }[task.priority]

    return new Response(
      `TASK_ID: ${task.id}\n` +
        `STATUS: ${task.status}\n` +
        `PRIORITY: ${task.priority}\n` +
        `TITLE: ${task.title}\n` +
        `${task.description ? `DESCRIPTION: ${task.description}\n` : ''}` +
        `${task.notes ? `NOTES: ${task.notes}\n` : ''}` +
        `\n${statusIcon} ${priorityIcon} ${task.title}\n`,
    )
  } catch (error) {
    console.error('CLI error:', error)
    return new Response('ERROR: Internal server error', { status: 500 })
  }
}

export async function POST(request: Request) {
  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return new Response('ERROR: Invalid JSON body', { status: 400 })
  }

  try {
    const apiKey = extractAgentApiKey(request, body)
    const action = cliActionSchema.safeParse(body.action)

    if (!apiKey) {
      return new Response('ERROR: Missing agent API key', { status: 401 })
    }

    if (!action.success) {
      return new Response(
        'ERROR: Unknown action\n' +
          'Available actions: claim, start, done, note, review\n' +
          'Example: { action: "claim", task_id: "abc123" } with Authorization: Bearer <agent-key>',
        { status: 400 },
      )
    }

    const MAX_FIELD_LENGTH = 5000
    const taskId = typeof body.task_id === 'string' ? body.task_id : null
    const rawNotes = typeof body.notes === 'string' ? body.notes : null
    const rawOutput = typeof body.output === 'string' ? body.output : null
    const notesTruncated = rawNotes !== null && rawNotes.length > MAX_FIELD_LENGTH
    const outputTruncated = rawOutput !== null && rawOutput.length > MAX_FIELD_LENGTH
    const notes = rawNotes !== null ? rawNotes.slice(0, MAX_FIELD_LENGTH) : null
    const output = rawOutput !== null ? rawOutput.slice(0, MAX_FIELD_LENGTH) : null

    const agent = await resolveAgentByApiKey(apiKey)

    if (!agent) {
      return new Response('ERROR: Invalid API key', { status: 401 })
    }

    await updateAgentHeartbeat(agent.id)

    switch (action.data) {
      case 'claim':
      case 'start': {
        if (!taskId) {
          const hint = action.data === 'claim'
            ? 'ERROR: Missing task_id\nUsage: { action: "claim", task_id: "xxx" }'
            : 'ERROR: Missing task_id'
          return new Response(hint, { status: 400 })
        }

        const actionName = action.data === 'claim' ? 'claimed' : 'started'
        const result = await claimOrStartTask(
          taskId,
          agent,
          actionName,
          `${actionName === 'claimed' ? 'Claimed' : 'Started'} via CLI`,
        )

        if ('error' in result) {
          return new Response(`ERROR: ${result.error}`, { status: result.status })
        }

        const verb = actionName === 'claimed' ? 'Claimed' : 'Started'
        const title = result.task?.title || taskId
        const suffix = actionName === 'claimed' ? `\nTASK_ID: ${taskId}\n` : '\n'
        return new Response(`OK: ${verb} task "${title}"${suffix}`)
      }

      case 'done': {
        if (!taskId) {
          return new Response('ERROR: Missing task_id', { status: 400 })
        }

        const task = await db.task.findUnique({
          where: { id: taskId },
          include: { steps: { select: { id: true, status: true, order: true, agentId: true } } }
        })
        if (!task || task.projectId !== agent.projectId) {
          return new Response('ERROR: Task not found', { status: 404 })
        }

        if (task.agentId !== agent.id) {
          return new Response('ERROR: Task is not assigned to this agent', { status: 403 })
        }

        // Handle chain steps
        const hasSteps = task.steps && task.steps.length > 0
        const stepId = typeof body.step_id === 'string' ? body.step_id : null

        // If step_id is provided, use it directly. Otherwise, find active steps
        // for this agent — but reject if ambiguous (multiple active branches).
        let activeStep: typeof task.steps[number] | null = null
        if (hasSteps) {
          if (stepId) {
            activeStep = task.steps.find(s => s.id === stepId && s.status === 'active') || null
          } else {
            const agentActiveSteps = task.steps.filter(s => s.status === 'active' && s.agentId === agent.id)
            if (agentActiveSteps.length > 1) {
              return new Response(
                'ERROR: Multiple active steps for this agent. Provide step_id to disambiguate.\n' +
                  agentActiveSteps.map(s => `  STEP_ID: ${s.id} (order ${s.order})`).join('\n') + '\n',
                { status: 409 },
              )
            }
            activeStep = agentActiveSteps[0] || null
          }
        }

        if (hasSteps && activeStep) {
          // Atomically mark the step as done only if still active (prevents double-completion)
          const completed = await db.taskStep.updateMany({
            where: { id: activeStep.id, status: 'active' },
            data: { status: 'done', output: output || '', completedAt: new Date() },
          })

          if (completed.count === 0) {
            return new Response('ERROR: Step already completed or no longer active', { status: 409 })
          }

          // Save output on task but don't change status — let advanceChain handle it
          await db.task.update({
            where: { id: taskId },
            data: { output: output || null },
            include: taskBoardInclude,
          })

          await db.activityLog.create({
            data: {
              action: 'completed',
              taskId,
              agentId: agent.id,
              projectId: agent.projectId,
              details: output || 'Step completed via CLI',
            },
          })

          try {
            await advanceChain(taskId, agent.projectId, activeStep.id)
          } catch (chainErr) {
            console.error('advanceChain failed after step completion:', chainErr)
            // Chain is stuck — set task to WAITING so the admin can intervene
            await db.task.update({
              where: { id: taskId },
              data: { status: 'WAITING' },
            }).catch(console.error)
          }

          broadcastProjectEvent(agent.projectId, 'task-updated', {
            ...task,
            output: output || null,
          })

          return new Response(`OK: Step completed for task "${task.title}"\n${outputTruncated ? 'WARNING: Output was truncated to 5000 characters\n' : ''}`)
        }

        // Non-chained task — original behavior
        const updatedTask = await db.task.update({
          where: { id: taskId },
          data: {
            status: 'DONE',
            completedAt: new Date(),
            output: output || null,
          },
          include: taskBoardInclude,
        })

        await db.activityLog.create({
          data: {
            action: 'completed',
            taskId,
            agentId: agent.id,
            projectId: agent.projectId,
            details: output || 'Completed via CLI',
          },
        })

        broadcastProjectEvent(agent.projectId, 'task-moved', {
          taskId,
          task: updatedTask,
        })
        broadcastProjectEvent(
          agent.projectId,
          'agent-activity',
          toRealtimeActivity({
            action: 'completed',
            agent,
            details: output || 'Completed via CLI',
            taskId,
          }),
        )

        return new Response(`OK: Completed task "${updatedTask.title}"\n${outputTruncated ? 'WARNING: Output was truncated to 5000 characters\n' : ''}`)
      }

      case 'note': {
        if (!taskId || !notes) {
          return new Response('ERROR: Missing task_id or notes', { status: 400 })
        }

        const task = await db.task.findUnique({ where: { id: taskId } })
        if (!task || task.projectId !== agent.projectId) {
          return new Response('ERROR: Task not found', { status: 404 })
        }

        if (task.agentId !== agent.id) {
          return new Response('ERROR: Task is not assigned to this agent', { status: 403 })
        }

        const updatedTask = await db.task.update({
          where: { id: taskId },
          data: { notes },
          include: taskBoardInclude,
        })

        await db.activityLog.create({
          data: {
            action: 'progress',
            taskId,
            agentId: agent.id,
            projectId: agent.projectId,
            details: notes,
          },
        })

        broadcastProjectEvent(agent.projectId, 'task-updated', updatedTask)
        broadcastProjectEvent(
          agent.projectId,
          'agent-activity',
          toRealtimeActivity({
            action: 'progress',
            agent,
            details: notes,
            taskId,
          }),
        )

        return new Response(`OK: Updated notes for task "${task.title}"\n${notesTruncated ? 'WARNING: Notes were truncated to 5000 characters\n' : ''}`)
      }

      case 'review': {
        if (!taskId) {
          return new Response('ERROR: Missing task_id', { status: 400 })
        }

        const task = await db.task.findUnique({ where: { id: taskId } })
        if (!task || task.projectId !== agent.projectId) {
          return new Response('ERROR: Task not found', { status: 404 })
        }

        if (task.agentId !== agent.id) {
          return new Response('ERROR: Task is not assigned to this agent', { status: 403 })
        }

        const updatedTask = await db.task.update({
          where: { id: taskId },
          data: {
            status: 'REVIEW',
            output: output || null,
          },
          include: taskBoardInclude,
        })

        await db.activityLog.create({
          data: {
            action: 'moved_to_review',
            taskId,
            agentId: agent.id,
            projectId: agent.projectId,
            details: output || 'Moved to review via CLI',
          },
        })

        broadcastProjectEvent(agent.projectId, 'task-moved', {
          taskId,
          task: updatedTask,
        })
        broadcastProjectEvent(
          agent.projectId,
          'agent-activity',
          toRealtimeActivity({
            action: 'moved_to_review',
            agent,
            details: output || 'Moved to review via CLI',
            taskId,
          }),
        )

        return new Response(`OK: Task "${task.title}" moved to review\n${outputTruncated ? 'WARNING: Output was truncated to 5000 characters\n' : ''}`)
      }
    }
  } catch (error) {
    console.error('CLI error:', error)
    return new Response('ERROR: Internal server error', { status: 500 })
  }
}
