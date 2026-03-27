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
    await broadcastProjectEvent(agent.projectId, 'agent-status', {
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
  try {
    const body = await request.json()
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
    const notes = typeof body.notes === 'string' ? body.notes.slice(0, MAX_FIELD_LENGTH) : null
    const output = typeof body.output === 'string' ? body.output.slice(0, MAX_FIELD_LENGTH) : null

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
          include: { steps: { select: { id: true, status: true, order: true } } }
        })
        if (!task || task.projectId !== agent.projectId) {
          return new Response('ERROR: Task not found', { status: 404 })
        }

        if (task.agentId !== agent.id) {
          return new Response('ERROR: Task is not assigned to this agent', { status: 403 })
        }

        // Handle chain steps
        const hasSteps = task.steps && task.steps.length > 0
        const activeStep = hasSteps ? task.steps.find(s => s.status === 'active') : null

        if (hasSteps && activeStep) {
          // Mark the active step as done
          await db.taskStep.update({
            where: { id: activeStep.id },
            data: { status: 'done', output: output || '', completedAt: new Date() },
          })

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

          advanceChain(taskId, agent.projectId).catch(console.error)

          await broadcastProjectEvent(agent.projectId, 'task-updated', {
            ...task,
            output: output || null,
          })

          return new Response(`OK: Step completed for task "${task.title}"\n`)
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

        await broadcastProjectEvent(agent.projectId, 'task-moved', {
          taskId,
          task: updatedTask,
        })
        await broadcastProjectEvent(
          agent.projectId,
          'agent-activity',
          toRealtimeActivity({
            action: 'completed',
            agent,
            details: output || 'Completed via CLI',
            taskId,
          }),
        )

        return new Response(`OK: Completed task "${updatedTask.title}"\n`)
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

        await broadcastProjectEvent(agent.projectId, 'task-updated', updatedTask)
        await broadcastProjectEvent(
          agent.projectId,
          'agent-activity',
          toRealtimeActivity({
            action: 'progress',
            agent,
            details: notes,
            taskId,
          }),
        )

        return new Response(`OK: Updated notes for task "${task.title}"\n`)
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

        await broadcastProjectEvent(agent.projectId, 'task-moved', {
          taskId,
          task: updatedTask,
        })
        await broadcastProjectEvent(
          agent.projectId,
          'agent-activity',
          toRealtimeActivity({
            action: 'moved_to_review',
            agent,
            details: output || 'Moved to review via CLI',
            taskId,
          }),
        )

        return new Response(`OK: Task "${task.title}" moved to review\n`)
      }
    }
  } catch (error) {
    console.error('CLI error:', error)
    return new Response('ERROR: Internal server error', { status: 500 })
  }
}
