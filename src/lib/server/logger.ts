/**
 * Structured logger for server-side code.
 *
 * In production: emits one JSON line per call (ts, level, tag, msg, ...meta, err).
 * In dev: emits a readable "[LEVEL] [tag] message" line, with the error
 * appended as a second argument so stack traces render in the terminal.
 *
 * Respects LOG_LEVEL env var (debug | info | warn | error). Defaults:
 * debug in dev, info in prod.
 *
 * Prefer `getLogger('namespace')` per module and call .debug/.info/.warn/.error
 * over raw console.*. Client components should not import this — it's
 * server-side only.
 */

type Level = 'debug' | 'info' | 'warn' | 'error'

const levelOrder: Level[] = ['debug', 'info', 'warn', 'error']

function configuredLevel(): Level {
  const raw = process.env.LOG_LEVEL as Level | undefined
  if (raw && levelOrder.includes(raw)) return raw
  return process.env.NODE_ENV === 'production' ? 'info' : 'debug'
}

function shouldLog(level: Level): boolean {
  return levelOrder.indexOf(level) >= levelOrder.indexOf(configuredLevel())
}

function serializeError(err: unknown) {
  if (err instanceof Error) {
    return { name: err.name, message: err.message, stack: err.stack }
  }
  return { value: String(err) }
}

function emit(
  level: Level,
  tag: string,
  message: string,
  meta?: Record<string, unknown>,
  err?: unknown,
) {
  if (!shouldLog(level)) return

  const isStderr = level === 'warn' || level === 'error'

  if (process.env.NODE_ENV === 'production') {
    const payload = {
      t: new Date().toISOString(),
      level,
      tag,
      msg: message,
      ...(meta || {}),
      ...(err !== undefined ? { err: serializeError(err) } : {}),
    }
    const line = JSON.stringify(payload)
    if (isStderr) console.error(line)
    else console.log(line)
    return
  }

  const prefix = `[${level.toUpperCase()}] [${tag}]`
  const metaStr = meta && Object.keys(meta).length > 0 ? ' ' + JSON.stringify(meta) : ''
  const head = `${prefix} ${message}${metaStr}`
  if (isStderr) {
    if (err !== undefined) console.error(head, err)
    else console.error(head)
  } else {
    console.log(head)
  }
}

export interface Logger {
  debug(message: string, meta?: Record<string, unknown>): void
  info(message: string, meta?: Record<string, unknown>): void
  warn(message: string, meta?: Record<string, unknown>): void
  error(message: string, err?: unknown, meta?: Record<string, unknown>): void
}

export function getLogger(tag: string): Logger {
  return {
    debug: (msg, meta) => emit('debug', tag, msg, meta),
    info: (msg, meta) => emit('info', tag, msg, meta),
    warn: (msg, meta) => emit('warn', tag, msg, meta),
    error: (msg, err, meta) => emit('error', tag, msg, meta, err),
  }
}
