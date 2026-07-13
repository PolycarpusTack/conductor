import { describe, test, expect, mock } from 'bun:test'

import { dbMock } from './db-mock'

describe('dbMock (TD-014b leak-safe db mock)', () => {
  test('explicit methods behave exactly as provided', async () => {
    const findMany = mock(() => Promise.resolve([{ id: 'x' }]))
    const db = dbMock({ task: { findMany } }) as any
    expect(await db.task.findMany({ where: {} })).toEqual([{ id: 'x' }])
    expect(findMany).toHaveBeenCalledTimes(1)
  })

  test('a method missing from an explicit model is a no-op, never "is not a function"', async () => {
    const db = dbMock({ task: { findMany: () => Promise.resolve([]) } }) as any
    // findUnique was NOT provided — the exact TD-014b crash surface.
    expect(typeof db.task.findUnique).toBe('function')
    expect(await db.task.findUnique({ where: { id: '1' } })).toBeNull()
  })

  test('an entirely unlisted model resolves to no-ops', async () => {
    const db = dbMock({}) as any
    expect(await db.stepExecution.create({ data: {} })).toBeNull()
    expect(await db.deadLetterStep.findFirst({})).toBeNull()
  })

  test('explicit client helpers ($queryRawUnsafe) pass through; unlisted $-helpers no-op', async () => {
    const $queryRawUnsafe = mock(() => Promise.resolve([{ n: 1 }]))
    const db = dbMock({ $queryRawUnsafe }) as any
    expect(await db.$queryRawUnsafe('SELECT 1')).toEqual([{ n: 1 }])
    expect(await db.$transaction([])).toBeNull() // unlisted → no-op
  })
})
