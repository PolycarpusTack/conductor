/**
 * Live output batching for session events (story A-3).
 *
 * The session-events endpoint takes ONE event per POST with a bounded chunk
 * (`sessionEventSchema`: output chunk ≤ 8000 chars). A CLI can emit output far
 * faster than we should POST, and A-1's fire-and-forget per-chunk posts could
 * reorder under latency and split NDJSON lines mid-byte. The batcher fixes
 * both:
 *
 *   - buffers per stream and flushes on an interval (~1.5s) or when a buffer
 *     outgrows a threshold — a handful of posts per second at most;
 *   - ships only COMPLETE lines mid-run (a half NDJSON line is useless to any
 *     consumer); the trailing partial line ships on close();
 *   - preserves order with a single send queue — events reach the server in
 *     flush order, one in flight at a time;
 *   - caps total streamed chars per stream so a runaway child cannot turn the
 *     daemon into an HTTP flood; the tail is dropped with one loud marker
 *     (the completion report still carries the authoritative output).
 *
 * Send errors are swallowed: session reporting must never break execution
 * (same rule as index.ts's sessionEvent()).
 */

export type StreamName = 'stdout' | 'stderr'

/** Shape of the session event this batcher emits — matches sessionEventSchema's 'output' member. */
export interface OutputEvent {
  type: 'output'
  stream: StreamName
  chunk: string
  truncated?: boolean
}

export interface OutputBatcherOptions {
  /** Delivers one event (an HTTP POST in production). Rejections are swallowed. */
  send: (event: OutputEvent) => Promise<void>
  /** Flush cadence while output trickles in. Default 1500ms. */
  flushIntervalMs?: number
  /** A stream buffer larger than this flushes immediately, timer or not. Default 4000. */
  maxBufferedChars?: number
  /** Hard per-event cap — must not exceed the server schema's 8000. Default 8000. */
  maxChunkChars?: number
  /**
   * Per-stream total cap; beyond it further output is dropped and a single
   * `truncated: true` marker event is sent. Default 256_000 chars.
   */
  maxStreamChars?: number
}

export class OutputBatcher {
  private readonly sendFn: (event: OutputEvent) => Promise<void>
  private readonly flushIntervalMs: number
  private readonly maxBufferedChars: number
  private readonly maxChunkChars: number
  private readonly maxStreamChars: number

  /** Complete lines awaiting a flush. */
  private complete: Record<StreamName, string> = { stdout: '', stderr: '' }
  /** Trailing text after the last newline — held back until more data or close(). */
  private partial: Record<StreamName, string> = { stdout: '', stderr: '' }
  private sentChars: Record<StreamName, number> = { stdout: 0, stderr: 0 }
  private capMarkerSent: Record<StreamName, boolean> = { stdout: false, stderr: false }

  /** Single delivery queue — the ordering guarantee. */
  private queue: Promise<void> = Promise.resolve()
  private timer: ReturnType<typeof setTimeout> | null = null
  private closed = false

  constructor(opts: OutputBatcherOptions) {
    this.sendFn = opts.send
    this.flushIntervalMs = opts.flushIntervalMs ?? 1500
    this.maxBufferedChars = opts.maxBufferedChars ?? 4000
    this.maxChunkChars = opts.maxChunkChars ?? 8000
    this.maxStreamChars = opts.maxStreamChars ?? 256_000
  }

  push(stream: StreamName, text: string): void {
    if (this.closed || !text) return

    const merged = this.partial[stream] + text
    const cut = merged.lastIndexOf('\n')
    if (cut === -1) {
      this.partial[stream] = merged
    } else {
      this.complete[stream] += merged.slice(0, cut + 1)
      this.partial[stream] = merged.slice(cut + 1)
    }

    // A child that never prints a newline must still stream: promote an
    // oversized partial to the flushable buffer.
    if (this.partial[stream].length >= this.maxBufferedChars) {
      this.complete[stream] += this.partial[stream]
      this.partial[stream] = ''
    }

    if (this.complete[stream].length >= this.maxBufferedChars) {
      this.flushStream(stream)
    } else if (this.complete[stream].length > 0) {
      this.armTimer()
    }
  }

  /** Final flush (including the trailing partial line) + drain of in-flight sends. */
  async close(): Promise<void> {
    if (!this.closed) {
      this.closed = true
      if (this.timer) {
        clearTimeout(this.timer)
        this.timer = null
      }
      for (const stream of ['stdout', 'stderr'] as const) {
        if (this.partial[stream]) {
          this.complete[stream] += this.partial[stream]
          this.partial[stream] = ''
        }
        this.flushStream(stream)
      }
    }
    await this.queue
  }

  private armTimer(): void {
    if (this.timer) return
    this.timer = setTimeout(() => {
      this.timer = null
      this.flushStream('stdout')
      this.flushStream('stderr')
    }, this.flushIntervalMs)
    // A pending flush must not keep the daemon process alive on its own.
    this.timer.unref?.()
  }

  private flushStream(stream: StreamName): void {
    const text = this.complete[stream]
    if (!text) return
    this.complete[stream] = ''

    const room = this.maxStreamChars - this.sentChars[stream]
    const ship = room <= 0 ? '' : text.length > room ? text.slice(0, room) : text
    const capped = ship.length < text.length
    this.sentChars[stream] += ship.length

    for (let i = 0; i < ship.length; i += this.maxChunkChars) {
      this.enqueue({ type: 'output', stream, chunk: ship.slice(i, i + this.maxChunkChars) })
    }
    if (capped && !this.capMarkerSent[stream]) {
      this.capMarkerSent[stream] = true
      this.enqueue({
        type: 'output',
        stream,
        chunk: `\n[${stream} stream truncated by daemon at ${this.maxStreamChars} chars — the full output arrives with step completion]\n`,
        truncated: true,
      })
    }
  }

  private enqueue(event: OutputEvent): void {
    this.queue = this.queue.then(() => this.sendFn(event)).catch(() => {})
  }
}
