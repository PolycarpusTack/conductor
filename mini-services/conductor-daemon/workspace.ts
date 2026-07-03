/**
 * Workspace registry & per-step cwd resolution (story A-2).
 *
 * SECURITY, not just correctness: headless `claude -p` skips the interactive
 * workspace-trust dialog (SPIKE A-0 §2.6, docs/gpm/state/spike-a0-headless-cli.md),
 * so whatever directory the runner spawns in is implicitly trusted by the CLI.
 * Therefore:
 *
 *   - the daemon executes ONLY inside an explicitly configured workspace
 *     directory (`DAEMON_WORKSPACE_ROOT`), validated at startup;
 *   - a step whose workspace cannot be resolved fails BEFORE anything spawns,
 *     with a durable `workspace_unmapped` error — there is deliberately no
 *     fallback to the daemon's own process.cwd();
 *   - `task-dir` working-directory policies are contained to the root by a
 *     traversal guard (server-sent ids are never trusted to build paths).
 *
 * A daemon is registered into exactly one workspace (Daemon.workspaceId) and
 * the server only leases steps from that workspace to it (daemon-dispatch is
 * workspace-scoped by design), so the registry is a single root path — the
 * daemon-local directory that workspace lives in.
 */

import { statSync } from 'node:fs'
import { isAbsolute, relative, resolve } from 'node:path'

/** Durable error code — reaches the server via the existing step-fail path. */
export const WORKSPACE_UNMAPPED = 'workspace_unmapped'

/** Startup-time misconfiguration — abort the daemon, don't limp into steps. */
export class WorkspaceConfigError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'WorkspaceConfigError'
  }
}

/**
 * Validates `DAEMON_WORKSPACE_ROOT` at startup. Returns the normalized
 * absolute path, or null when unset (the daemon then fails every step with
 * `workspace_unmapped` — loud and durable, never silently local).
 * Relative paths, missing paths, and non-directories abort startup.
 */
export function resolveWorkspaceRoot(raw: string | undefined): string | null {
  const value = (raw ?? '').trim()
  if (!value) return null
  if (!isAbsolute(value)) {
    throw new WorkspaceConfigError(`DAEMON_WORKSPACE_ROOT must be an absolute path — got "${value}"`)
  }
  const root = resolve(value)
  let stats
  try {
    stats = statSync(root)
  } catch {
    throw new WorkspaceConfigError(`DAEMON_WORKSPACE_ROOT does not exist: ${root}`)
  }
  if (!stats.isDirectory()) {
    throw new WorkspaceConfigError(`DAEMON_WORKSPACE_ROOT is not a directory: ${root}`)
  }
  return root
}

export type StepCwdResolution = { ok: true; cwd: string } | { ok: false; error: string }

export interface StepCwdInput {
  taskId: string
  /** `session.workingDirectoryPolicy` from the Execution Payload. */
  workingDirectoryPolicy?: string | null
}

/**
 * Resolves the directory a step's child process must spawn in.
 *
 *   - `project-root` / `daemon-default` / anything unknown → the workspace
 *     root ("daemon-default" no longer means the daemon's own cwd — that
 *     fallback is exactly what A-2 forbids)
 *   - `task-dir` → `<root>/<taskId>`, guarded against escaping the root
 *     (the caller creates the directory after a successful resolution)
 *   - no root configured → `workspace_unmapped` failure, no spawn
 */
export function resolveStepCwd(root: string | null, step: StepCwdInput): StepCwdResolution {
  if (!root) {
    return {
      ok: false,
      error:
        `${WORKSPACE_UNMAPPED}: this daemon has no workspace directory configured ` +
        `(set DAEMON_WORKSPACE_ROOT to the absolute path of the workspace checkout); ` +
        `refusing to execute in the daemon's own working directory`,
    }
  }

  if (step.workingDirectoryPolicy === 'task-dir') {
    const candidate = resolve(root, step.taskId)
    // Traversal guard: the resolved dir must be a strict child of the root.
    // path.relative on win32 compares case-insensitively; '' means the task id
    // collapsed onto the root itself (e.g. empty or '.') — reject that too.
    const rel = relative(root, candidate)
    if (rel === '' || rel.startsWith('..') || isAbsolute(rel)) {
      return {
        ok: false,
        error: `${WORKSPACE_UNMAPPED}: task-dir for task "${step.taskId}" escapes the configured workspace root`,
      }
    }
    return { ok: true, cwd: candidate }
  }

  return { ok: true, cwd: root }
}
