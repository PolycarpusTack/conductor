import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { getLogger } from '../logger'

let logLines: unknown[][] = []
let errorLines: unknown[][] = []
let originalLog: typeof console.log
let originalError: typeof console.error
let originalLevel: string | undefined

beforeEach(() => {
  logLines = []
  errorLines = []
  originalLog = console.log
  originalError = console.error
  originalLevel = process.env.LOG_LEVEL
  console.log = (...args: unknown[]) => { logLines.push(args) }
  console.error = (...args: unknown[]) => { errorLines.push(args) }
})

afterEach(() => {
  console.log = originalLog
  console.error = originalError
  if (originalLevel === undefined) delete process.env.LOG_LEVEL
  else process.env.LOG_LEVEL = originalLevel
})

describe('getLogger', () => {
  test('tags messages with the namespace', () => {
    process.env.LOG_LEVEL = 'debug'
    getLogger('my-module').info('hello')
    expect(logLines).toHaveLength(1)
    expect(String(logLines[0][0])).toContain('[my-module]')
    expect(String(logLines[0][0])).toContain('hello')
  })

  test('routes warn and error to stderr', () => {
    process.env.LOG_LEVEL = 'debug'
    const log = getLogger('t')
    log.warn('careful')
    log.error('broken', new Error('cause'))
    expect(errorLines).toHaveLength(2)
    expect(logLines).toHaveLength(0)
  })

  test('respects LOG_LEVEL filtering', () => {
    process.env.LOG_LEVEL = 'error'
    const log = getLogger('t')
    log.debug('nope')
    log.info('nope')
    log.warn('nope')
    log.error('yes')
    expect(logLines).toHaveLength(0)
    expect(errorLines).toHaveLength(1)
  })

  test('includes structured meta in the line', () => {
    process.env.LOG_LEVEL = 'debug'
    getLogger('t').info('with meta', { stepId: 'step-1' })
    expect(String(logLines[0][0])).toContain('step-1')
  })
})
