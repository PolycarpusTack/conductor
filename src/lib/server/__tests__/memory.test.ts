import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { db } from '@/lib/db'
import { buildWorkingMemory } from '@/lib/server/memory'

describe('buildWorkingMemory', () => {
  let projectId: string
  let agentId: string

  beforeEach(async () => {
    const project = await db.project.create({ data: { name: 'mem-test' } })
    projectId = project.id
    const agent = await db.agent.create({
      data: { name: 'memtest-agent', projectId },
    })
    agentId = agent.id
  })

  afterEach(async () => {
    await db.project.delete({ where: { id: projectId } }).catch(() => {})
  })

  test('returns empty string when agent has no completed tasks', async () => {
    const result = await buildWorkingMemory({ agentId, projectId })
    expect(result).toBe('')
  })

  test('formats recent completed tasks with title and output', async () => {
    await db.task.create({
      data: {
        title: 'Fix login bug',
        status: 'DONE',
        output: 'Root cause: timeout in auth.ts. Fixed by bumping to 60s.',
        completedAt: new Date(),
        projectId,
        agentId,
      },
    })

    const result = await buildWorkingMemory({ agentId, projectId })
    expect(result).toContain('Fix login bug')
    expect(result).toContain('Root cause: timeout')
  })

  test('limits to most recent N tasks (default 5)', async () => {
    for (let i = 0; i < 8; i++) {
      await db.task.create({
        data: {
          title: `Task ${i}`,
          status: 'DONE',
          output: `output-${i}`,
          completedAt: new Date(Date.now() + i * 1000),
          projectId,
          agentId,
        },
      })
    }
    const result = await buildWorkingMemory({ agentId, projectId, maxRecent: 5 })
    expect(result).toContain('Task 7')
    expect(result).toContain('Task 3')
    expect(result).not.toContain('Task 2')
  })

  test('truncates each task output to maxCharsPerEntry', async () => {
    await db.task.create({
      data: {
        title: 'Big task',
        status: 'DONE',
        output: 'x'.repeat(5000),
        completedAt: new Date(),
        projectId,
        agentId,
      },
    })
    const result = await buildWorkingMemory({ agentId, projectId, maxCharsPerEntry: 200 })
    expect(result.length).toBeLessThan(600)
    expect(result).toContain('Big task')
  })

  test('only includes DONE tasks, not IN_PROGRESS or BACKLOG', async () => {
    await db.task.create({
      data: { title: 'In-progress task', status: 'IN_PROGRESS', projectId, agentId },
    })
    const result = await buildWorkingMemory({ agentId, projectId })
    expect(result).not.toContain('In-progress task')
  })

  test('only includes tasks for the given (agent, project) pair', async () => {
    const otherAgent = await db.agent.create({ data: { name: 'other', projectId } })
    await db.task.create({
      data: {
        title: "Other agent's task",
        status: 'DONE',
        output: 'should not appear',
        completedAt: new Date(),
        projectId,
        agentId: otherAgent.id,
      },
    })
    const result = await buildWorkingMemory({ agentId, projectId })
    expect(result).not.toContain("Other agent's task")
  })
})
