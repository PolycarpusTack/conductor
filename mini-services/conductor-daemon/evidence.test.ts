import { describe, test, expect, beforeAll } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  CLAUDE_METADATA_ARTIFACT_LABEL,
  GIT_DIFF_ARTIFACT_LABEL,
  buildCompletionArtifacts,
  collectGitEvidence,
} from './evidence'
import type { StepRunOutcome } from './runner'

// ---------------------------------------------------------------------------
// collectGitEvidence — real temp git repos (no mocks; spawn discipline is the
// thing under test)
// ---------------------------------------------------------------------------

function git(cwd: string, ...args: string[]): void {
  const res = spawnSync('git', ['-c', 'user.email=test@example.com', '-c', 'user.name=Test', ...args], {
    cwd,
    shell: false,
    encoding: 'utf8',
  })
  if (res.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${res.stderr}`)
}

const dirtyRepo = mkdtempSync(join(tmpdir(), 'conductor-git-dirty-'))
const cleanRepo = mkdtempSync(join(tmpdir(), 'conductor-git-clean-'))
const plainDir = mkdtempSync(join(tmpdir(), 'conductor-git-none-'))
process.on('exit', () => {
  for (const dir of [dirtyRepo, cleanRepo, plainDir]) rmSync(dir, { recursive: true, force: true })
})

beforeAll(() => {
  // Dirty repo: one committed file modified + one untracked file.
  git(dirtyRepo, 'init')
  writeFileSync(join(dirtyRepo, 'app.ts'), 'export const a = 1\n')
  git(dirtyRepo, 'add', '.')
  git(dirtyRepo, 'commit', '-m', 'init')
  writeFileSync(join(dirtyRepo, 'app.ts'), 'export const a = 2\nexport const extra = true\n')
  writeFileSync(join(dirtyRepo, 'untracked.ts'), 'export const b = 1\n')

  // Clean repo: committed and untouched.
  git(cleanRepo, 'init')
  writeFileSync(join(cleanRepo, 'lib.ts'), 'export const c = 3\n')
  git(cleanRepo, 'add', '.')
  git(cleanRepo, 'commit', '-m', 'init')
})

describe('collectGitEvidence', () => {
  test('a dirty repo yields the diff --stat and the dirty-file count', async () => {
    const evidence = await collectGitEvidence(dirtyRepo)
    expect(evidence).not.toBeNull()
    expect(evidence!.diffStat).toContain('app.ts')
    expect(evidence!.diffStat).toContain('1 file changed')
    // modified app.ts + untracked untracked.ts
    expect(evidence!.dirtyFiles).toBe(2)
    expect(evidence!.truncated).toBe(false)
  })

  test('a clean repo yields empty diffStat and zero dirty files (still evidence)', async () => {
    const evidence = await collectGitEvidence(cleanRepo)
    expect(evidence).not.toBeNull()
    expect(evidence!.diffStat).toBe('')
    expect(evidence!.dirtyFiles).toBe(0)
  })

  test('a directory outside any git repo yields null — silent skip', async () => {
    expect(await collectGitEvidence(plainDir)).toBeNull()
  })

  test('a missing git binary yields null — never an error', async () => {
    expect(await collectGitEvidence(dirtyRepo, { gitBin: 'conductor-no-such-git-binary' })).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// buildCompletionArtifacts — pure shaping logic
// ---------------------------------------------------------------------------

function outcome(overrides: Partial<StepRunOutcome> = {}): StepRunOutcome {
  return { ok: true, exitCode: 0, output: 'done', error: null, claude: null, ...overrides }
}

describe('buildCompletionArtifacts', () => {
  test('git evidence becomes a diff artifact with dirty-file metadata', () => {
    const artifacts = buildCompletionArtifacts(outcome(), { diffStat: ' app.ts | 2 +-', dirtyFiles: 2, truncated: false })
    expect(artifacts).toHaveLength(1)
    expect(artifacts[0]).toMatchObject({
      type: 'diff',
      label: GIT_DIFF_ARTIFACT_LABEL,
      content: ' app.ts | 2 +-',
      metadata: { dirtyFiles: 2, truncated: false },
    })
  })

  test('claude result metadata becomes a json artifact (cost parked for B-7)', () => {
    const artifacts = buildCompletionArtifacts(
      outcome({ claude: { isError: false, result: 'ok', totalCostUsd: 0.0123, numTurns: 4, sessionId: 'sess-abc' } }),
      null,
    )
    expect(artifacts).toHaveLength(1)
    expect(artifacts[0].type).toBe('json')
    expect(artifacts[0].label).toBe(CLAUDE_METADATA_ARTIFACT_LABEL)
    expect(artifacts[0].metadata).toMatchObject({ totalCostUsd: 0.0123, numTurns: 4, claudeSessionId: 'sess-abc' })
    expect(JSON.parse(artifacts[0].content!)).toMatchObject({ totalCostUsd: 0.0123, numTurns: 4 })
  })

  test('no git evidence and no claude line → no artifacts (generic runner in a non-repo)', () => {
    expect(buildCompletionArtifacts(outcome(), null)).toEqual([])
  })

  test('a FAILED outcome still carries git evidence — reviewers need it most there', () => {
    const artifacts = buildCompletionArtifacts(
      outcome({ ok: false, exitCode: 1, error: 'exit code 1: boom' }),
      { diffStat: ' half-done.ts | 9 +++', dirtyFiles: 1, truncated: false },
    )
    expect(artifacts).toHaveLength(1)
    expect(artifacts[0].type).toBe('diff')
  })

  test('an empty diffStat on a repo still produces the artifact (clean tree is evidence)', () => {
    const artifacts = buildCompletionArtifacts(outcome(), { diffStat: '', dirtyFiles: 0, truncated: false })
    expect(artifacts).toHaveLength(1)
    expect(artifacts[0].content).toContain('no unstaged changes')
  })
})
