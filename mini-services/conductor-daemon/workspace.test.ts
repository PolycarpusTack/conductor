import { describe, test, expect } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve, sep } from 'node:path'

import {
  WORKSPACE_UNMAPPED,
  WorkspaceConfigError,
  resolveStepCwd,
  resolveWorkspaceRoot,
} from './workspace'

const ROOT = mkdtempSync(join(tmpdir(), 'conductor-ws-'))
const FILE_IN_ROOT = join(ROOT, 'not-a-dir.txt')
writeFileSync(FILE_IN_ROOT, 'x')
process.on('exit', () => rmSync(ROOT, { recursive: true, force: true }))

// ---------------------------------------------------------------------------
// Startup validation (fail at boot, not mid-step)
// ---------------------------------------------------------------------------

describe('resolveWorkspaceRoot', () => {
  test('unset or blank means no workspace is mapped', () => {
    expect(resolveWorkspaceRoot(undefined)).toBeNull()
    expect(resolveWorkspaceRoot('')).toBeNull()
    expect(resolveWorkspaceRoot('   ')).toBeNull()
  })

  test('a valid absolute directory resolves to its normalized path', () => {
    expect(resolveWorkspaceRoot(ROOT)).toBe(resolve(ROOT))
    // trailing separator + redundant segments are normalized away
    expect(resolveWorkspaceRoot(`${ROOT}${sep}`)).toBe(resolve(ROOT))
    expect(resolveWorkspaceRoot(join(ROOT, '.') + sep)).toBe(resolve(ROOT))
  })

  test('a relative path is rejected at startup', () => {
    expect(() => resolveWorkspaceRoot('workspaces/main')).toThrow(WorkspaceConfigError)
    expect(() => resolveWorkspaceRoot('./here')).toThrow(/absolute/)
    expect(() => resolveWorkspaceRoot('..')).toThrow(/absolute/)
  })

  test('a nonexistent path is rejected at startup', () => {
    expect(() => resolveWorkspaceRoot(join(ROOT, 'does-not-exist'))).toThrow(WorkspaceConfigError)
    expect(() => resolveWorkspaceRoot(join(ROOT, 'does-not-exist'))).toThrow(/exist/)
  })

  test('a file (not a directory) is rejected at startup', () => {
    expect(() => resolveWorkspaceRoot(FILE_IN_ROOT)).toThrow(/directory/)
  })
})

// ---------------------------------------------------------------------------
// Per-step cwd resolution (SECURITY: never the daemon's own cwd)
// ---------------------------------------------------------------------------

describe('resolveStepCwd', () => {
  const step = (workingDirectoryPolicy?: string, taskId = 'task-1') => ({ taskId, workingDirectoryPolicy })

  test('no mapped workspace fails with workspace_unmapped (never falls back to process.cwd())', () => {
    const res = resolveStepCwd(null, step('project-root'))
    expect(res.ok).toBe(false)
    if (!res.ok) {
      expect(res.error).toContain(WORKSPACE_UNMAPPED)
      expect(res.error).toContain('DAEMON_WORKSPACE_ROOT')
      expect(res.error).not.toContain(process.cwd())
    }
  })

  test('project-root, daemon-default, and unknown policies all resolve to the workspace root', () => {
    for (const policy of ['project-root', 'daemon-default', undefined, 'something-new']) {
      const res = resolveStepCwd(ROOT, step(policy))
      expect(res).toEqual({ ok: true, cwd: resolve(ROOT) })
    }
  })

  test('task-dir resolves to a task subdirectory inside the root', () => {
    const res = resolveStepCwd(ROOT, step('task-dir', 'task-abc'))
    expect(res).toEqual({ ok: true, cwd: join(resolve(ROOT), 'task-abc') })
  })

  test('a task id that escapes the root is rejected before any spawn (traversal guard)', () => {
    for (const evil of ['../evil', '..', `..${sep}..${sep}etc`, resolve(ROOT, '..', 'outside')]) {
      const res = resolveStepCwd(ROOT, step('task-dir', evil))
      expect(res.ok).toBe(false)
      if (!res.ok) expect(res.error).toContain(WORKSPACE_UNMAPPED)
    }
  })

  test('an empty task id cannot silently resolve to the root itself under task-dir', () => {
    const res = resolveStepCwd(ROOT, step('task-dir', ''))
    expect(res.ok).toBe(false)
  })
})
