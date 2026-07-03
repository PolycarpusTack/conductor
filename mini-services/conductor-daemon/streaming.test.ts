import { describe, test, expect } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { OutputBatcher, type OutputEvent } from './streaming'
import { buildClaudeSpawnSpec, parseClaudeResultLine, runSpawnSpec, type ExecutionPayload } from './runner'

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

function recorder() {
  const events: OutputEvent[] = []
  return {
    events,
    send: (event: OutputEvent) => {
      events.push(event)
      return Promise.resolve()
    },
  }
}

const joined = (events: OutputEvent[], stream?: 'stdout' | 'stderr') =>
  events
    .filter((e) => !e.truncated && (!stream || e.stream === stream))
    .map((e) => e.chunk)
    .join('')

describe('OutputBatcher — batching & line handling', () => {
  test('ships only complete lines while running; the partial tail ships on close', async () => {
    const rec = recorder()
    const batcher = new OutputBatcher({ send: rec.send, flushIntervalMs: 10 })

    batcher.push('stdout', 'line1\nline2\npartial')
    await sleep(40)

    // Mid-run: everything delivered so far ends at a line boundary.
    expect(rec.events.length).toBeGreaterThanOrEqual(1)
    expect(joined(rec.events)).toBe('line1\nline2\n')
    for (const event of rec.events) expect(event.chunk.endsWith('\n')).toBe(true)

    await batcher.close()
    expect(joined(rec.events)).toBe('line1\nline2\npartial')
  })

  test('batches many rapid lines into few, order-preserving events', async () => {
    const rec = recorder()
    const batcher = new OutputBatcher({ send: rec.send, flushIntervalMs: 10 })

    const lines = Array.from({ length: 50 }, (_, i) => `line-${i}\n`)
    for (const line of lines) batcher.push('stdout', line)
    await batcher.close()

    expect(joined(rec.events)).toBe(lines.join(''))
    // 50 pushes must NOT mean 50 HTTP posts — they fit one buffered flush.
    expect(rec.events.length).toBe(1)
  })

  test('flushes early when the buffer outgrows maxBufferedChars (no timer wait)', async () => {
    const rec = recorder()
    const batcher = new OutputBatcher({
      send: rec.send,
      flushIntervalMs: 60_000, // timer alone would never fire inside the test
      maxBufferedChars: 100,
    })

    batcher.push('stdout', `${'x'.repeat(150)}\n`)
    await sleep(10)
    expect(rec.events.length).toBeGreaterThanOrEqual(1)
    await batcher.close()
    expect(joined(rec.events)).toBe(`${'x'.repeat(150)}\n`)
  })

  test('splits an oversized flush into chunk-capped events (server schema max)', async () => {
    const rec = recorder()
    const batcher = new OutputBatcher({ send: rec.send, maxChunkChars: 50, maxBufferedChars: 10_000 })

    const text = `${'a'.repeat(60)}\n${'b'.repeat(60)}\n`
    batcher.push('stdout', text)
    await batcher.close()

    expect(joined(rec.events)).toBe(text)
    for (const event of rec.events) expect(event.chunk.length).toBeLessThanOrEqual(50)
    expect(rec.events.length).toBeGreaterThan(1)
  })

  test('caps total streamed chars per stream with a single truncated marker', async () => {
    const rec = recorder()
    const batcher = new OutputBatcher({ send: rec.send, maxStreamChars: 100, flushIntervalMs: 5 })

    batcher.push('stdout', `${'a'.repeat(80)}\n`)
    await sleep(30)
    batcher.push('stdout', `${'b'.repeat(80)}\n`)
    await sleep(30)
    batcher.push('stdout', `${'c'.repeat(80)}\n`)
    await batcher.close()

    expect(joined(rec.events).length).toBeLessThanOrEqual(100)
    const markers = rec.events.filter((e) => e.truncated)
    expect(markers.length).toBe(1)
  })

  test('a rejecting send does not break later deliveries', async () => {
    const delivered: string[] = []
    let first = true
    const batcher = new OutputBatcher({
      send: (event) => {
        if (first) {
          first = false
          return Promise.reject(new Error('server hiccup'))
        }
        delivered.push(event.chunk)
        return Promise.resolve()
      },
      flushIntervalMs: 5,
    })

    batcher.push('stdout', 'lost\n')
    await sleep(30)
    batcher.push('stdout', 'kept\n')
    await batcher.close()

    expect(delivered).toEqual(['kept\n'])
  })

  test('stdout and stderr keep their stream tags through the shared queue', async () => {
    const rec = recorder()
    const batcher = new OutputBatcher({ send: rec.send })

    batcher.push('stdout', 'out\n')
    batcher.push('stderr', 'err\n')
    await batcher.close()

    expect(joined(rec.events, 'stdout')).toBe('out\n')
    expect(joined(rec.events, 'stderr')).toBe('err\n')
  })

  test('a no-newline stream still flushes once the partial outgrows the buffer', async () => {
    const rec = recorder()
    const batcher = new OutputBatcher({ send: rec.send, flushIntervalMs: 60_000, maxBufferedChars: 100 })

    batcher.push('stdout', 'y'.repeat(150)) // no newline at all
    await sleep(10)
    expect(joined(rec.events)).toBe('y'.repeat(150))
    await batcher.close()
  })
})

// ---------------------------------------------------------------------------
// Live-streaming integration: fake CLI emits NDJSON lines over time; the
// batcher must deliver them WHILE the process runs, in order, line-complete.
// ---------------------------------------------------------------------------

const FAKE_CLI = join(import.meta.dir, 'test-fixtures', 'fake-cli.ts')
const TEST_WORKSPACE = mkdtempSync(join(tmpdir(), 'conductor-stream-ws-'))
process.on('exit', () => rmSync(TEST_WORKSPACE, { recursive: true, force: true }))

function streamingPayload(): ExecutionPayload {
  return {
    payloadVersion: 1,
    id: 'step-stream',
    taskId: 'task-stream',
    mode: 'develop',
    instructions: 'stream test',
    timeoutMs: 30_000,
    session: {
      policy: 'ephemeral',
      backend: 'process',
      sessionKey: 'step-step-stream',
      command: null,
      commandError: null,
      maxOutputPreviewChars: 5000,
    },
    agent: null,
    task: { id: 'task-stream', title: 'Streaming' },
  }
}

describe('OutputBatcher — live streaming from a running CLI', () => {
  test('events are delivered in order while the process runs; reassembly matches stdout', async () => {
    const rec = recorder()
    const batcher = new OutputBatcher({ send: rec.send, flushIntervalMs: 20 })

    const spec = buildClaudeSpawnSpec(streamingPayload(), { binArgv: [process.execPath, FAKE_CLI] })
    const proc = await runSpawnSpec(spec, {
      timeoutMs: 30_000,
      cwd: TEST_WORKSPACE,
      env: { FAKE_STREAM_LINES: '6', FAKE_STREAM_DELAY_MS: '40' },
      onStdout: (chunk) => batcher.push('stdout', chunk),
      onStderr: (chunk) => batcher.push('stderr', chunk),
    })
    await batcher.close()

    expect(proc.exitCode).toBe(0)
    // Delivered LIVE (multiple flush cycles), not one post-mortem blob.
    expect(rec.events.length).toBeGreaterThanOrEqual(2)
    // Nothing lost, nothing reordered.
    expect(joined(rec.events, 'stdout')).toBe(proc.stdout)
    // Every mid-run chunk is line-complete → each is valid NDJSON on its own.
    for (const event of rec.events.slice(0, -1)) {
      expect(event.chunk.endsWith('\n')).toBe(true)
    }
    // The final result line still parses out of the reassembled stream.
    const result = parseClaudeResultLine(joined(rec.events, 'stdout'))
    expect(result?.isError).toBe(false)
  }, 20_000)
})
