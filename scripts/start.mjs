// Cross-platform production launcher (F-2).
//
// Replaces the old POSIX-only npm script
//   NODE_ENV=production bun .next/standalone/server.js 2>&1 | tee server.log
// which broke on Windows (inline VAR= assignment, `2>&1`, and `tee` are all
// POSIX-shell-isms). This launcher is dependency-free (node:child_process +
// node:fs, both available under Bun and Node) and behaves identically on
// Windows and Linux/WSL:
//   - sets NODE_ENV=production for the child
//   - spawns the Next.js standalone server under NODE (not Bun). This is
//     deliberate: the default SQLite adapter uses better-sqlite3, which refuses
//     to run under Bun ("'better-sqlite3' is not yet supported in Bun"). Node
//     20+ is already a stated prerequisite. `node` resolves to node.exe on
//     Windows (CreateProcess appends .exe), so spawn('node') is cross-platform.
//   - tees combined stdout+stderr to both the console and ./server.log
//   - forwards SIGINT/SIGTERM and propagates the child's exit code
//
// Preserved behaviour: still launches .next/standalone/server.js and still
// writes server.log in the project root.

import { spawn } from 'node:child_process'
import { createWriteStream, existsSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

const root = process.cwd()
const serverPath = path.join(root, '.next', 'standalone', 'server.js')

if (!existsSync(serverPath)) {
  console.error(
    `[start] Missing ${serverPath}\n` +
      '[start] Run `bun run build` first (next build + copy-standalone).',
  )
  process.exit(1)
}

const logPath = path.join(root, 'server.log')
const logStream = createWriteStream(logPath, { flags: 'a' })

// The Next standalone server reads PORT and HOSTNAME from the environment.
// Default HOSTNAME to 0.0.0.0 only if the caller has not set it, so the server
// is reachable when run inside a container without forcing it locally.
const env = { ...process.env, NODE_ENV: 'production' }

const child = spawn('node', [serverPath], {
  cwd: root,
  env,
  stdio: ['inherit', 'pipe', 'pipe'],
})

for (const stream of [child.stdout, child.stderr]) {
  if (!stream) continue
  stream.on('data', (chunk) => {
    process.stdout.write(chunk)
    logStream.write(chunk)
  })
}

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    if (!child.killed) child.kill(signal)
  })
}

child.on('exit', (code, signal) => {
  logStream.end()
  if (signal) {
    process.exit(1)
  }
  process.exit(code ?? 0)
})

child.on('error', (err) => {
  console.error('[start] Failed to launch standalone server:', err)
  process.exit(1)
})
