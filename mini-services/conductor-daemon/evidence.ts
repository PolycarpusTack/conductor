/**
 * Post-run evidence capture (story A-3).
 *
 * After the child exits — success OR failure — the daemon gathers what a
 * reviewer needs to trust the step:
 *
 *   - git evidence: when the resolved cwd is inside a git work tree,
 *     `git diff --stat` plus a dirty-file count from `git status --porcelain`,
 *     shipped as a 'diff' artifact on the completion report. Not a repo, or
 *     git not installed → skip silently (evidence is best-effort, never a
 *     failure cause).
 *   - claude run metadata (total_cost_usd / num_turns / session_id from the
 *     final stream-json result line): the daemon lease path has NO
 *     StepExecution row (dispatch.ts's HTTP path owns those) and TaskStep has
 *     no cost fields, so — without schema changes — this rides a 'json'
 *     artifact. B-7 should move it into StepExecution.tokensUsed/cost once the
 *     daemon path allocates execution rows.
 *
 * Same spawn discipline as runner.ts: argument arrays, shell: false, explicit
 * cwd, bounded by a timeout.
 */

import { spawn } from 'node:child_process'

import type { StepRunOutcome } from './runner'

const GIT_TIMEOUT_MS = 10_000
/** diff --stat cap — keep the TAIL (the "N files changed…" summary is last). */
const DIFF_STAT_MAX_CHARS = 16_000

interface GitCmdResult {
  exitCode: number
  stdout: string
}

function runGitCommand(gitBin: string, args: string[], cwd: string, timeoutMs: number): Promise<GitCmdResult> {
  return new Promise((resolve) => {
    let child: ReturnType<typeof spawn>
    try {
      child = spawn(gitBin, args, { shell: false, cwd, stdio: ['ignore', 'pipe', 'pipe'] })
    } catch {
      resolve({ exitCode: 127, stdout: '' })
      return
    }
    let stdout = ''
    child.stdout?.on('data', (chunk: Buffer) => {
      stdout += chunk.toString()
    })
    // Drain stderr so a chatty git can never block on a full pipe; content is irrelevant.
    child.stderr?.on('data', () => {})
    const timer = setTimeout(() => child.kill(), timeoutMs)
    child.on('close', (code) => {
      clearTimeout(timer)
      resolve({ exitCode: code ?? 1, stdout })
    })
    child.on('error', () => {
      clearTimeout(timer)
      resolve({ exitCode: 127, stdout: '' })
    })
  })
}

export interface GitEvidence {
  /** `git diff --stat` output (tail-capped at DIFF_STAT_MAX_CHARS). Empty = clean tree. */
  diffStat: string
  /** Non-empty `git status --porcelain` lines — staged + unstaged + untracked. */
  dirtyFiles: number
  /** True when diffStat was cut to the cap. */
  truncated: boolean
}

export interface GitEvidenceOptions {
  /** Git binary — tests point this at a nonexistent binary to prove the silent skip. */
  gitBin?: string
  timeoutMs?: number
}

/**
 * Returns null (never throws) when cwd is not inside a git work tree or git
 * is not available — evidence capture must never fail a step.
 */
export async function collectGitEvidence(cwd: string, opts: GitEvidenceOptions = {}): Promise<GitEvidence | null> {
  const gitBin = opts.gitBin ?? 'git'
  const timeoutMs = opts.timeoutMs ?? GIT_TIMEOUT_MS

  const probe = await runGitCommand(gitBin, ['rev-parse', '--is-inside-work-tree'], cwd, timeoutMs)
  if (probe.exitCode !== 0 || probe.stdout.trim() !== 'true') return null

  const [diff, status] = await Promise.all([
    runGitCommand(gitBin, ['diff', '--stat'], cwd, timeoutMs),
    runGitCommand(gitBin, ['status', '--porcelain'], cwd, timeoutMs),
  ])

  const rawDiff = diff.exitCode === 0 ? diff.stdout.trimEnd() : ''
  const truncated = rawDiff.length > DIFF_STAT_MAX_CHARS
  const diffStat = truncated ? rawDiff.slice(-DIFF_STAT_MAX_CHARS) : rawDiff
  const dirtyFiles =
    status.exitCode === 0 ? status.stdout.split(/\r?\n/).filter((line) => line.trim().length > 0).length : 0

  return { diffStat, dirtyFiles, truncated }
}

// ---------------------------------------------------------------------------
// Completion artifacts — shape matches the server's stepArtifactSchema
// (src/lib/server/contracts.ts): { type, label, content?, mimeType?, metadata? }
// ---------------------------------------------------------------------------

export interface StepArtifactInput {
  type: 'diff' | 'json'
  label: string
  content?: string
  mimeType?: string
  metadata?: Record<string, unknown>
}

export const GIT_DIFF_ARTIFACT_LABEL = 'git diff --stat'
export const CLAUDE_METADATA_ARTIFACT_LABEL = 'claude run metadata'

export function buildCompletionArtifacts(outcome: StepRunOutcome, git: GitEvidence | null): StepArtifactInput[] {
  const artifacts: StepArtifactInput[] = []

  if (git) {
    artifacts.push({
      type: 'diff',
      label: GIT_DIFF_ARTIFACT_LABEL,
      content: git.diffStat || '(working tree has no unstaged changes)',
      metadata: { dirtyFiles: git.dirtyFiles, truncated: git.truncated },
    })
  }

  const claude = outcome.claude
  if (claude && (claude.totalCostUsd !== undefined || claude.numTurns !== undefined || claude.sessionId !== undefined)) {
    // Cost/turns/session have no schema home on the daemon path (no
    // StepExecution row, no TaskStep cost fields) — parked as an artifact
    // WITHOUT schema changes. B-7: move into StepExecution.cost/tokensUsed.
    const metadata: Record<string, unknown> = {
      totalCostUsd: claude.totalCostUsd ?? null,
      numTurns: claude.numTurns ?? null,
      claudeSessionId: claude.sessionId ?? null,
      exitCode: outcome.exitCode,
    }
    artifacts.push({
      type: 'json',
      label: CLAUDE_METADATA_ARTIFACT_LABEL,
      content: JSON.stringify(metadata, null, 2),
      mimeType: 'application/json',
      metadata,
    })
  }

  return artifacts
}
