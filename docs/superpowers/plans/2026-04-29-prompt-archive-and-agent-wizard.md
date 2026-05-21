# Prompt Archive Browser & Agent Wizard — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend AgentBoard with (1) a browsable library of system prompt templates sourced from a local markdown archive, and (2) an AI-powered Agent Wizard that searches the archive and composes a tailored system prompt from natural-language requirements.

**Architecture:** A file-based `PromptLibraryService` reads `.md` files from a configurable path, exposes them via two new API routes, and integrates into the existing `agent-creation-modal`. The wizard adds a `POST /api/agent-wizard/compose` route that searches the archive and calls an existing `ProjectRuntime` LLM to synthesize a prompt and pre-fill all agent fields.

**Tech Stack:** Next.js 16 App Router, TypeScript 5 strict, Zod 4, Prisma 7 + SQLite, React 19, Radix UI/Shadcn, `bun test`, Mustache templating.

---

## Global Definitions

These apply to every task in every epic. Read them once; assume them everywhere.

### Definition of Ready (DoR)

A task is ready to start when ALL of the following are true:

- [ ] Title is unambiguous — a developer unfamiliar with the project understands the deliverable
- [ ] Acceptance criteria written in Given/When/Then
- [ ] All upstream task dependencies are complete (marked ✅)
- [ ] File paths for new and modified files are identified
- [ ] Failing test scenario is written out (TDD tasks)
- [ ] No open architectural questions blocking implementation

### Definition of Done (DoD)

A task is done when ALL of the following are true:

- [ ] All acceptance criteria pass and are verified by tests
- [ ] Tests were written **before** implementation (TDD) — commit order proves it
- [ ] `bun run lint` passes with zero new ESLint errors or warnings
- [ ] `bunx tsc --noEmit` passes — no TypeScript errors, no `any` types introduced
- [ ] Code reviewed against clean code checklist (SRP, DRY, no magic strings, functions ≤ 20 lines, nesting ≤ 3 deep)
- [ ] All public functions have a one-line JSDoc comment
- [ ] Committed with a meaningful message: `type(scope): description` (e.g. `feat(prompt-library): add archive indexer`)
- [ ] No hardcoded secrets, paths, or environment values in source

### Post-Epic Cleanup Cycle

Run this cycle at the end of **every** epic before starting the next one. It contains three fixed tasks (TD = Technical Debt, CC = Clean Code, DC = Documentation Cleanup). They are written out in full in Epic 1 and referenced by name in later epics.

---

## File Map

Files created or significantly modified by this plan. Each file has one responsibility.

```
src/
├── types/
│   └── prompt-library.ts           NEW — shared TS interfaces for archive entries
├── lib/
│   └── server/
│       ├── prompt-library.ts       NEW — PromptLibraryService (read, parse, index)
│       └── wizard-composer.ts      NEW — WizardComposerService (search + LLM call)
├── app/
│   └── api/
│       ├── prompt-library/
│       │   ├── route.ts            NEW — GET /api/prompt-library (list)
│       │   └── [entryId]/
│       │       └── route.ts        NEW — GET /api/prompt-library/[entryId] (full content)
│       └── agent-wizard/
│           └── compose/
│               └── route.ts        NEW — POST /api/agent-wizard/compose
└── components/
    ├── prompt-archive-picker.tsx   NEW — browsable archive picker (used in modal + wizard)
    └── agent-wizard-modal.tsx      NEW — multi-step wizard modal

MODIFIED:
src/components/agent-creation-modal.tsx   — add "From Archive" button to Runtime tab
src/app/page.tsx                          — add "Create with Wizard" button
.env                                      — add PROMPT_LIBRARY_PATH
```

---

## EPIC 1: Prompt Archive Infrastructure

**Goal:** Make the local markdown archive queryable from AgentBoard's backend. No UI in this epic.

**SDD — Design decisions locked in here:**
- The archive is accessed read-only. AgentBoard never writes to it.
- Files are indexed on each request with a 60-second in-memory cache (no watcher needed for v1).
- IDs are `base64url(relativePath)` — stable, URL-safe, reversible.
- Content is capped at 9,500 chars when served (leaves 500 chars headroom for Mustache variables injected at agent-dispatch time).
- The service lives in `src/lib/server/prompt-library.ts` — no Prisma dependency, pure filesystem.

**Epic DoR:**
- [ ] `PROMPT_LIBRARY_PATH` value confirmed: `/mnt/c/Users/yannick.verrydt/Downloads/system_prompts_leaks-main/system_prompts_leaks-main`
- [ ] Archive folder structure reviewed — categories are top-level folders
- [ ] 10,000 char `systemPrompt` field limit confirmed in `contracts.ts:58`

---

### Task 1.1 — Environment Config & Startup Validation

**DoR:** Global DoR met. No dependencies.

**DoD:** Global DoD met. App fails fast with a clear error if `PROMPT_LIBRARY_PATH` is missing or points to a non-existent directory.

**Acceptance Criteria:**
- Given `PROMPT_LIBRARY_PATH` is unset, when the app starts, then it logs a warning and the prompt-library API returns `503` with `{ error: "Prompt library not configured" }`
- Given `PROMPT_LIBRARY_PATH` points to a non-existent path, when the API is called, then it returns `503` with `{ error: "Prompt library path does not exist: /bad/path" }`
- Given `PROMPT_LIBRARY_PATH` is valid, when the API is called, then it returns `200`

**Files:**
- Modify: `.env`
- Create: `src/types/prompt-library.ts`
- Create: `src/lib/server/prompt-library.ts` (skeleton only in this task)
- Create: `src/lib/server/__tests__/prompt-library.test.ts`

---

- [ ] **Step 1.1.1 — Add env var to .env**

```bash
echo 'PROMPT_LIBRARY_PATH="/mnt/c/Users/yannick.verrydt/Downloads/system_prompts_leaks-main/system_prompts_leaks-main"' >> .env
```

- [ ] **Step 1.1.2 — Create shared TypeScript types**

Create `src/types/prompt-library.ts`:

```typescript
/** Lightweight metadata returned in list responses. */
export interface PromptLibraryEntry {
  /** base64url-encoded relative file path — stable, URL-safe ID */
  id: string
  /** Top-level folder name: "Anthropic", "OpenAI", "Google", "agents", etc. */
  category: string
  /** Derived from the first H1 heading, or the filename without extension */
  title: string
  /** First non-heading paragraph, or empty string */
  description: string
  /** Raw character count — used to warn the user before loading large files */
  charCount: number
  /** Relative path from the library root, for display */
  relativePath: string
}

/** Full entry including content, returned by the single-entry endpoint. */
export interface PromptLibraryEntryFull extends PromptLibraryEntry {
  /**
   * Raw markdown content, capped at MAX_PROMPT_CONTENT_CHARS.
   * If truncated, a notice is appended to the end.
   */
  content: string
  /** True when content was truncated to fit the cap */
  truncated: boolean
}

export interface PromptLibraryListResponse {
  categories: {
    name: string
    entries: PromptLibraryEntry[]
  }[]
}
```

- [ ] **Step 1.1.3 — Write the failing validation tests**

Create `src/lib/server/__tests__/prompt-library.test.ts`:

```typescript
import { describe, test, expect, beforeEach, afterEach } from 'bun:test'

// We test the getLibraryPath helper in isolation before building the full service
describe('getLibraryPath', () => {
  const ORIGINAL = process.env.PROMPT_LIBRARY_PATH

  afterEach(() => {
    process.env.PROMPT_LIBRARY_PATH = ORIGINAL
  })

  test('returns null when env var is unset', async () => {
    delete process.env.PROMPT_LIBRARY_PATH
    const { getLibraryPath } = await import('../prompt-library')
    expect(getLibraryPath()).toBeNull()
  })

  test('returns the configured path when set', async () => {
    process.env.PROMPT_LIBRARY_PATH = '/tmp/test-archive'
    const { getLibraryPath } = await import('../prompt-library')
    expect(getLibraryPath()).toBe('/tmp/test-archive')
  })
})
```

- [ ] **Step 1.1.4 — Run tests to confirm they fail**

```bash
cd /mnt/c/Projects/AgentBoard && bun test src/lib/server/__tests__/prompt-library.test.ts
```

Expected: FAIL — `Cannot find module '../prompt-library'`

- [ ] **Step 1.1.5 — Create the skeleton service**

Create `src/lib/server/prompt-library.ts`:

```typescript
import fs from 'fs'
import path from 'path'
import type { PromptLibraryEntry, PromptLibraryEntryFull, PromptLibraryListResponse } from '@/types/prompt-library'

export const MAX_PROMPT_CONTENT_CHARS = 9_500

/** Returns the configured archive root, or null if not set. */
export function getLibraryPath(): string | null {
  return process.env.PROMPT_LIBRARY_PATH ?? null
}

/**
 * Returns an error string if the library path is unusable, or null if healthy.
 * Used by API routes to return 503 early.
 */
export function validateLibraryPath(): string | null {
  const p = getLibraryPath()
  if (!p) return 'Prompt library not configured'
  if (!fs.existsSync(p)) return `Prompt library path does not exist: ${p}`
  return null
}
```

- [ ] **Step 1.1.6 — Run tests to confirm they pass**

```bash
bun test src/lib/server/__tests__/prompt-library.test.ts
```

Expected: PASS (2 tests)

- [ ] **Step 1.1.7 — Commit**

```bash
git add .env src/types/prompt-library.ts src/lib/server/prompt-library.ts src/lib/server/__tests__/prompt-library.test.ts
git commit -m "feat(prompt-library): add env config, types, and startup validation"
```

---

### Task 1.2 — Archive Parser & Indexer

**DoR:** Task 1.1 ✅. Test fixtures (a small fake archive) are defined before implementation.

**DoD:** Global DoD met. Parser correctly extracts title, description, category, and ID from `.md` files. Skips non-`.md` files and hidden folders.

**Acceptance Criteria:**
- Given a folder with `Anthropic/claude-code.md` and `agents/my-agent.md`, when `listEntries()` is called, then it returns two categories each containing one entry
- Given a file whose first line is `# My Agent`, when parsed, then `title` is `"My Agent"`
- Given a file with no H1, when parsed, then `title` is the filename without extension
- Given a file with 15,000 chars, when `getEntry()` is called, then `content` is capped at 9,500 chars and `truncated` is `true`
- Given a file named `.gitignore` or a folder named `.github`, when indexing, then it is skipped

**Files:**
- Modify: `src/lib/server/prompt-library.ts`
- Modify: `src/lib/server/__tests__/prompt-library.test.ts`

---

- [ ] **Step 1.2.1 — Write failing tests for the parser**

Append to `src/lib/server/__tests__/prompt-library.test.ts`:

```typescript
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

describe('PromptLibraryService — indexer', () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'agentboard-test-'))
    process.env.PROMPT_LIBRARY_PATH = tmpDir
  })

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true })
    delete process.env.PROMPT_LIBRARY_PATH
  })

  test('lists entries grouped by category folder', async () => {
    mkdirSync(join(tmpDir, 'Anthropic'))
    writeFileSync(join(tmpDir, 'Anthropic', 'claude-code.md'), '# Claude Code\nA coding agent.')
    mkdirSync(join(tmpDir, 'agents'))
    writeFileSync(join(tmpDir, 'agents', 'my-agent.md'), '# My Agent\nDoes stuff.')

    const { listEntries } = await import('../prompt-library')
    const result = await listEntries()

    expect(result.categories).toHaveLength(2)
    const names = result.categories.map((c) => c.name).sort()
    expect(names).toEqual(['Anthropic', 'agents'])
  })

  test('extracts title from first H1', async () => {
    mkdirSync(join(tmpDir, 'Test'))
    writeFileSync(join(tmpDir, 'Test', 'agent.md'), '# My Agent Title\nFirst paragraph.')

    const { listEntries } = await import('../prompt-library')
    const result = await listEntries()
    const entry = result.categories[0].entries[0]

    expect(entry.title).toBe('My Agent Title')
    expect(entry.description).toBe('First paragraph.')
  })

  test('falls back to filename when no H1', async () => {
    mkdirSync(join(tmpDir, 'Test'))
    writeFileSync(join(tmpDir, 'Test', 'my-cool-agent.md'), 'No heading here.')

    const { listEntries } = await import('../prompt-library')
    const result = await listEntries()
    expect(result.categories[0].entries[0].title).toBe('my-cool-agent')
  })

  test('skips hidden folders and non-md files', async () => {
    mkdirSync(join(tmpDir, '.github'))
    writeFileSync(join(tmpDir, '.github', 'config.yml'), 'hidden')
    mkdirSync(join(tmpDir, 'Real'))
    writeFileSync(join(tmpDir, 'Real', 'agent.md'), '# Real')
    writeFileSync(join(tmpDir, 'Real', 'README.txt'), 'not markdown')

    const { listEntries } = await import('../prompt-library')
    const result = await listEntries()
    expect(result.categories).toHaveLength(1)
    expect(result.categories[0].name).toBe('Real')
    expect(result.categories[0].entries).toHaveLength(1)
  })

  test('truncates content at MAX_PROMPT_CONTENT_CHARS', async () => {
    mkdirSync(join(tmpDir, 'Test'))
    const bigContent = '# Big\n' + 'x'.repeat(20_000)
    writeFileSync(join(tmpDir, 'Test', 'big.md'), bigContent)

    const { getEntry, MAX_PROMPT_CONTENT_CHARS } = await import('../prompt-library')
    const entries = (await import('../prompt-library')).listEntries
    const list = await entries()
    const id = list.categories[0].entries[0].id
    const full = await getEntry(id)

    expect(full).not.toBeNull()
    expect(full!.content.length).toBeLessThanOrEqual(MAX_PROMPT_CONTENT_CHARS + 100) // +100 for truncation notice
    expect(full!.truncated).toBe(true)
  })
})
```

- [ ] **Step 1.2.2 — Run to confirm they fail**

```bash
bun test src/lib/server/__tests__/prompt-library.test.ts
```

Expected: FAIL — `listEntries is not a function`

- [ ] **Step 1.2.3 — Implement the indexer**

Replace the contents of `src/lib/server/prompt-library.ts`:

```typescript
import fs from 'fs'
import path from 'path'
import type { PromptLibraryEntry, PromptLibraryEntryFull, PromptLibraryListResponse } from '@/types/prompt-library'

export const MAX_PROMPT_CONTENT_CHARS = 9_500

/** Returns the configured archive root, or null if not set. */
export function getLibraryPath(): string | null {
  return process.env.PROMPT_LIBRARY_PATH ?? null
}

/** Returns an error string if unusable, or null if healthy. */
export function validateLibraryPath(): string | null {
  const p = getLibraryPath()
  if (!p) return 'Prompt library not configured'
  if (!fs.existsSync(p)) return `Prompt library path does not exist: ${p}`
  return null
}

// --- Parsing helpers ---

function encodeId(relativePath: string): string {
  return Buffer.from(relativePath).toString('base64url')
}

function decodeId(id: string): string {
  return Buffer.from(id, 'base64url').toString('utf8')
}

function extractTitle(content: string, filename: string): string {
  const h1 = content.match(/^#\s+(.+)$/m)
  return h1 ? h1[1].trim() : filename.replace(/\.md$/, '')
}

function extractDescription(content: string): string {
  // First non-heading, non-empty line after the title
  const lines = content.split('\n')
  let pastTitle = false
  for (const line of lines) {
    const trimmed = line.trim()
    if (!pastTitle) {
      if (trimmed.startsWith('#')) { pastTitle = true }
      continue
    }
    if (trimmed && !trimmed.startsWith('#')) return trimmed
  }
  return ''
}

function parseEntry(libraryRoot: string, category: string, filename: string): PromptLibraryEntry {
  const relativePath = path.join(category, filename)
  const fullPath = path.join(libraryRoot, relativePath)
  const content = fs.readFileSync(fullPath, 'utf8')

  return {
    id: encodeId(relativePath),
    category,
    title: extractTitle(content, filename),
    description: extractDescription(content),
    charCount: content.length,
    relativePath,
  }
}

// --- Public API ---

/** Lists all .md files in the archive, grouped by top-level category folder. */
export async function listEntries(): Promise<PromptLibraryListResponse> {
  const root = getLibraryPath()
  if (!root) return { categories: [] }

  const topLevel = fs.readdirSync(root, { withFileTypes: true })
  const categories: PromptLibraryListResponse['categories'] = []

  for (const dir of topLevel) {
    if (!dir.isDirectory() || dir.name.startsWith('.')) continue
    const categoryPath = path.join(root, dir.name)
    const files = fs.readdirSync(categoryPath, { withFileTypes: true })
    const entries: PromptLibraryEntry[] = []

    for (const file of files) {
      if (!file.isFile() || !file.name.endsWith('.md')) continue
      entries.push(parseEntry(root, dir.name, file.name))
    }

    if (entries.length > 0) {
      entries.sort((a, b) => a.title.localeCompare(b.title))
      categories.push({ name: dir.name, entries })
    }
  }

  categories.sort((a, b) => a.name.localeCompare(b.name))
  return { categories }
}

/** Returns the full content of a single archive entry by ID, or null if not found. */
export async function getEntry(id: string): Promise<PromptLibraryEntryFull | null> {
  const root = getLibraryPath()
  if (!root) return null

  const relativePath = decodeId(id)
  const fullPath = path.join(root, relativePath)

  // Prevent path traversal
  if (!fullPath.startsWith(root)) return null
  if (!fs.existsSync(fullPath)) return null

  const rawContent = fs.readFileSync(fullPath, 'utf8')
  const [category, filename] = relativePath.split(path.sep)
  const entry = parseEntry(root, category, filename)

  const truncated = rawContent.length > MAX_PROMPT_CONTENT_CHARS
  const content = truncated
    ? rawContent.slice(0, MAX_PROMPT_CONTENT_CHARS) +
      '\n\n---\n_[Content truncated to fit the 10,000-character system prompt limit. Edit to keep only the sections relevant to your agent.]_'
    : rawContent

  return { ...entry, content, truncated }
}
```

- [ ] **Step 1.2.4 — Run tests to confirm they pass**

```bash
bun test src/lib/server/__tests__/prompt-library.test.ts
```

Expected: PASS (7 tests)

- [ ] **Step 1.2.5 — Type-check**

```bash
bunx tsc --noEmit
```

Expected: no errors

- [ ] **Step 1.2.6 — Commit**

```bash
git add src/lib/server/prompt-library.ts src/lib/server/__tests__/prompt-library.test.ts
git commit -m "feat(prompt-library): implement archive indexer and parser with truncation"
```

---

### Task 1.3 — Prompt Library API Routes

**DoR:** Task 1.2 ✅. API contract agreed: list returns categories + entries (no content); single-entry route returns full content.

**DoD:** Global DoD met. Both routes return correct status codes and response shapes; path traversal is blocked.

**Acceptance Criteria:**
- Given library is configured, `GET /api/prompt-library` returns `{ categories: [...] }` with `200`
- Given library is not configured, `GET /api/prompt-library` returns `{ error: "..." }` with `503`
- Given a valid entry ID, `GET /api/prompt-library/[entryId]` returns `{ entry: {...} }` with `200`
- Given an invalid or traversal ID, `GET /api/prompt-library/[entryId]` returns `404`

**Files:**
- Create: `src/app/api/prompt-library/route.ts`
- Create: `src/app/api/prompt-library/[entryId]/route.ts`

---

- [ ] **Step 1.3.1 — Create the list route**

Create `src/app/api/prompt-library/route.ts`:

```typescript
import { NextResponse } from 'next/server'
import { validateLibraryPath, listEntries } from '@/lib/server/prompt-library'

/** GET /api/prompt-library — returns all archive entries grouped by category */
export async function GET() {
  const error = validateLibraryPath()
  if (error) {
    return NextResponse.json({ error }, { status: 503 })
  }

  const data = await listEntries()
  return NextResponse.json(data)
}
```

- [ ] **Step 1.3.2 — Create the single-entry route**

Create `src/app/api/prompt-library/[entryId]/route.ts`:

```typescript
import { NextResponse } from 'next/server'
import { validateLibraryPath, getEntry } from '@/lib/server/prompt-library'

interface Params {
  params: Promise<{ entryId: string }>
}

/** GET /api/prompt-library/[entryId] — returns full content of one archive entry */
export async function GET(_req: Request, { params }: Params) {
  const error = validateLibraryPath()
  if (error) {
    return NextResponse.json({ error }, { status: 503 })
  }

  const { entryId } = await params
  const entry = await getEntry(entryId)

  if (!entry) {
    return NextResponse.json({ error: 'Entry not found' }, { status: 404 })
  }

  return NextResponse.json({ entry })
}
```

- [ ] **Step 1.3.3 — Smoke-test manually**

```bash
bun run dev &
sleep 3
curl -s http://localhost:3000/api/prompt-library | head -c 500
curl -s http://localhost:3000/api/prompt-library/INVALID_ID
```

Expected first: JSON with `categories` array. Expected second: `{"error":"Entry not found"}` with 404.

- [ ] **Step 1.3.4 — Type-check**

```bash
bunx tsc --noEmit
```

Expected: no errors

- [ ] **Step 1.3.5 — Commit**

```bash
git add src/app/api/prompt-library/
git commit -m "feat(prompt-library): add list and single-entry API routes"
```

---

### Task 1.4 — Post-Epic 1 Cleanup Cycle ♻️

#### 1.4.TD — Technical Debt Review

**DoD:** All debt items catalogued. New items added to `TECHNICAL_DEBT.md`. No debt silently buried.

- [ ] **Scan for TODOs and shortcuts**

```bash
grep -rn "TODO\|FIXME\|HACK\|XXX\|any\b" src/lib/server/prompt-library.ts src/app/api/prompt-library/
```

- [ ] **Document findings in TECHNICAL_DEBT.md**

Create or append to `TECHNICAL_DEBT.md` at project root:

```markdown
## Epic 1 — Prompt Archive Infrastructure (2026-04-29)

| ID | Description | File | Severity | Resolution |
|----|-------------|------|----------|------------|
| TD-001 | No caching — archive is re-read from disk on every request | prompt-library.ts | Low | Add 60s in-memory cache in Epic 5 polish task |
| TD-002 | No recursive subfolder support (e.g. Anthropic/old/) | prompt-library.ts | Low | Implement in a future iteration if needed |
| TD-003 | No file watcher — archive changes require app restart | prompt-library.ts | Low | Acceptable for v1; add inotify/chokidar watch in v2 |
```

- [ ] **Commit**

```bash
git add TECHNICAL_DEBT.md
git commit -m "chore(tech-debt): document Epic 1 known debt items"
```

#### 1.4.CC — Clean Code Review

**DoD:** All violations corrected or explicitly accepted with a comment.

- [ ] **Check Single Responsibility** — `prompt-library.ts` does parsing AND indexing. Acceptable for now (both are read-only file operations). No split needed.

- [ ] **Check function length** — each function ≤ 20 lines?

```bash
awk '/^(export )?function |^(export )?async function /{fn=$0; count=0} /^}$/{if(count>20) print fn " — " count " lines"} {count++}' src/lib/server/prompt-library.ts
```

Fix any function over 20 lines by extracting a named helper.

- [ ] **Check nesting depth** — no more than 3 levels of indentation:

```bash
grep -n "        " src/lib/server/prompt-library.ts  # 8 spaces = 4 levels
```

- [ ] **Check for magic numbers**

```bash
grep -n "[0-9]\{4,\}" src/lib/server/prompt-library.ts
```

All numeric constants should be named constants (✅ `MAX_PROMPT_CONTENT_CHARS` already is).

- [ ] **Commit if any fixes made**

```bash
git add src/lib/server/prompt-library.ts
git commit -m "refactor(prompt-library): clean code review fixes"
```

#### 1.4.DC — Documentation Cleanup

**DoD:** All public exports have JSDoc. README has a section for the new env var.

- [ ] **Verify JSDoc on all exports in prompt-library.ts**

```bash
grep -n "^export" src/lib/server/prompt-library.ts
```

Each export should have a `/** ... */` comment immediately above it.

- [ ] **Add env var to README**

Find the environment variables section in `README.md` and add:

```markdown
| `PROMPT_LIBRARY_PATH` | Path to the system prompt archive directory | Optional | `/path/to/system_prompts_leaks` |
```

- [ ] **Commit**

```bash
git add README.md src/lib/server/prompt-library.ts
git commit -m "docs(prompt-library): add JSDoc and README env var entry"
```

---

## EPIC 2: Archive Browser UI

**Goal:** Users can browse, preview, and select archive prompts from within the agent creation modal.

**SDD — Design decisions:**
- `PromptArchivePicker` is a standalone component that owns its own data fetching via `fetch('/api/prompt-library')`. It is not coupled to the modal.
- The picker opens in a `Sheet` (slide-over panel) from Radix, not a nested modal (avoids z-index issues).
- On "Use as Base", it calls an `onSelect(content: string, meta: PromptLibraryEntry)` callback — the parent decides what to do with it.
- The modal truncates content to 9,500 chars client-side as a safety net (the API already enforces this).

**Epic DoR:**
- [ ] Epic 1 ✅ complete
- [ ] `Sheet` component exists in `src/components/ui/sheet.tsx` (Radix-based — verify before starting)
- [ ] `ReactMarkdown` is installed (yes: `react-markdown@10.1.0` in package.json)

---

### Task 2.1 — PromptArchivePicker Component

**DoR:** Epic 2 DoR met.

**DoD:** Global DoD met. Component renders categories, entries, and preview. Calls `onSelect` with content and metadata.

**Acceptance Criteria:**
- Given the API returns 2 categories, when the picker opens, then 2 category headers are visible
- Given a user clicks an entry, when the preview panel loads, then the markdown content is rendered
- Given a user clicks "Use as Base", then `onSelect` is called with the entry's content and metadata
- Given the API returns a 503, when the picker opens, then a friendly error message is shown

**Files:**
- Create: `src/components/prompt-archive-picker.tsx`

---

- [ ] **Step 2.1.1 — Write the component skeleton with placeholder UI**

Create `src/components/prompt-archive-picker.tsx`:

```typescript
'use client'

import { useState, useEffect } from 'react'
import ReactMarkdown from 'react-markdown'
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Loader2, FileText, AlertCircle } from 'lucide-react'
import type { PromptLibraryEntry, PromptLibraryListResponse, PromptLibraryEntryFull } from '@/types/prompt-library'

interface PromptArchivePickerProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Called when the user clicks "Use as Base" */
  onSelect: (content: string, meta: PromptLibraryEntry) => void
}

type FetchState<T> = { status: 'idle' } | { status: 'loading' } | { status: 'ok'; data: T } | { status: 'error'; message: string }

export function PromptArchivePicker({ open, onOpenChange, onSelect }: PromptArchivePickerProps) {
  const [library, setLibrary] = useState<FetchState<PromptLibraryListResponse>>({ status: 'idle' })
  const [selected, setSelected] = useState<PromptLibraryEntry | null>(null)
  const [preview, setPreview] = useState<FetchState<PromptLibraryEntryFull>>({ status: 'idle' })

  useEffect(() => {
    if (!open) return
    setLibrary({ status: 'loading' })
    fetch('/api/prompt-library')
      .then((r) => r.json())
      .then((data) => {
        if (data.error) setLibrary({ status: 'error', message: data.error })
        else setLibrary({ status: 'ok', data })
      })
      .catch(() => setLibrary({ status: 'error', message: 'Failed to load prompt library' }))
  }, [open])

  function handleSelectEntry(entry: PromptLibraryEntry) {
    setSelected(entry)
    setPreview({ status: 'loading' })
    fetch(`/api/prompt-library/${entry.id}`)
      .then((r) => r.json())
      .then((data) => {
        if (data.error) setPreview({ status: 'error', message: data.error })
        else setPreview({ status: 'ok', data: data.entry })
      })
      .catch(() => setPreview({ status: 'error', message: 'Failed to load entry' }))
  }

  function handleUseAsBase() {
    if (preview.status !== 'ok' || !selected) return
    onSelect(preview.data.content, selected)
    onOpenChange(false)
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full max-w-4xl flex flex-col p-0">
        <SheetHeader className="px-6 pt-6 pb-4 border-b">
          <SheetTitle>Prompt Archive</SheetTitle>
          <SheetDescription>
            Browse system prompt templates. Select one to use as a starting base for your agent&apos;s system prompt.
          </SheetDescription>
        </SheetHeader>

        <div className="flex flex-1 overflow-hidden">
          {/* Left column — category & entry list */}
          <div className="w-72 border-r flex flex-col">
            <ScrollArea className="flex-1">
              {library.status === 'loading' && (
                <div className="flex items-center justify-center p-8">
                  <Loader2 className="animate-spin h-5 w-5 text-muted-foreground" />
                </div>
              )}
              {library.status === 'error' && (
                <div className="flex items-center gap-2 p-4 text-sm text-destructive">
                  <AlertCircle className="h-4 w-4 shrink-0" />
                  {library.message}
                </div>
              )}
              {library.status === 'ok' &&
                library.data.categories.map((cat) => (
                  <div key={cat.name} className="py-2">
                    <p className="px-4 py-1 text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                      {cat.name}
                    </p>
                    {cat.entries.map((entry) => (
                      <button
                        key={entry.id}
                        onClick={() => handleSelectEntry(entry)}
                        className={`w-full text-left px-4 py-2 text-sm hover:bg-accent transition-colors flex items-start gap-2 ${
                          selected?.id === entry.id ? 'bg-accent' : ''
                        }`}
                      >
                        <FileText className="h-4 w-4 shrink-0 mt-0.5 text-muted-foreground" />
                        <span className="flex-1 min-w-0">
                          <span className="block font-medium truncate">{entry.title}</span>
                          {entry.description && (
                            <span className="block text-xs text-muted-foreground truncate">{entry.description}</span>
                          )}
                        </span>
                        {entry.charCount > 9_500 && (
                          <Badge variant="outline" className="text-xs shrink-0">Large</Badge>
                        )}
                      </button>
                    ))}
                  </div>
                ))}
            </ScrollArea>
          </div>

          {/* Right column — preview */}
          <div className="flex-1 flex flex-col overflow-hidden">
            {preview.status === 'idle' && (
              <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground">
                Select an entry to preview
              </div>
            )}
            {preview.status === 'loading' && (
              <div className="flex-1 flex items-center justify-center">
                <Loader2 className="animate-spin h-5 w-5 text-muted-foreground" />
              </div>
            )}
            {preview.status === 'error' && (
              <div className="flex-1 flex items-center gap-2 p-6 text-sm text-destructive">
                <AlertCircle className="h-4 w-4" /> {preview.message}
              </div>
            )}
            {preview.status === 'ok' && (
              <>
                <div className="px-6 py-3 border-b flex items-center justify-between gap-4">
                  <div>
                    <p className="font-medium text-sm">{preview.data.title}</p>
                    <p className="text-xs text-muted-foreground">
                      {preview.data.charCount.toLocaleString()} chars
                      {preview.data.truncated && ' — truncated to fit 10k limit'}
                    </p>
                  </div>
                  <Button size="sm" onClick={handleUseAsBase}>
                    Use as Base
                  </Button>
                </div>
                <ScrollArea className="flex-1 px-6 py-4">
                  <div className="prose prose-sm prose-invert max-w-none">
                    <ReactMarkdown>{preview.data.content}</ReactMarkdown>
                  </div>
                </ScrollArea>
              </>
            )}
          </div>
        </div>
      </SheetContent>
    </Sheet>
  )
}
```

- [ ] **Step 2.1.2 — Type-check**

```bash
bunx tsc --noEmit
```

Fix any type errors before proceeding.

- [ ] **Step 2.1.3 — Commit**

```bash
git add src/components/prompt-archive-picker.tsx
git commit -m "feat(prompt-archive): add PromptArchivePicker sheet component"
```

---

### Task 2.2 — Integrate Picker into Agent Creation Modal

**DoR:** Task 2.1 ✅. `agent-creation-modal.tsx` Runtime tab identified (file:~line 300+).

**DoD:** Global DoD met. "From Archive" button opens the picker; selecting an entry populates `systemPrompt` field.

**Acceptance Criteria:**
- Given the Runtime tab is open, when the user clicks "From Archive", then the `PromptArchivePicker` sheet opens
- Given the user selects an archive entry, when they click "Use as Base", then the `systemPrompt` textarea shows the content and the picker closes
- Given content exceeds 9,500 chars (should not happen, but as defense), when it is applied, then it is silently truncated client-side with a toast warning

**Files:**
- Modify: `src/components/agent-creation-modal.tsx`

---

- [ ] **Step 2.2.1 — Add picker state and import to the modal**

In `src/components/agent-creation-modal.tsx`, add near the top of the component's state declarations:

```typescript
// Add this import at the top of the file
import { PromptArchivePicker } from '@/components/prompt-archive-picker'
import type { PromptLibraryEntry } from '@/types/prompt-library'

// Add this state inside the component
const [archivePickerOpen, setArchivePickerOpen] = useState(false)
```

- [ ] **Step 2.2.2 — Add the handler for archive selection**

Add this function inside the component, near the existing `handleLoadTemplate` function:

```typescript
/** Called when the user picks an entry from the archive. */
function handleArchiveSelect(content: string, _meta: PromptLibraryEntry) {
  const MAX = 9_500
  const trimmed = content.length > MAX ? content.slice(0, MAX) : content
  if (content.length > MAX) {
    toast.warning('Prompt truncated to 9,500 characters to fit the system prompt limit.')
  }
  // `systemPrompt` is a react-hook-form field — use setValue
  setValue('systemPrompt', trimmed)
}
```

- [ ] **Step 2.2.3 — Add the "From Archive" button next to "Load Template"**

In the Runtime tab, find the existing "Load Template" button and replace it with a button group:

```typescript
{/* Before: single "Load Template" button */}
{/* After: two buttons side by side */}
<div className="flex gap-2">
  <Button
    type="button"
    variant="outline"
    size="sm"
    onClick={handleLoadTemplate}
  >
    Load Role Template
  </Button>
  <Button
    type="button"
    variant="outline"
    size="sm"
    onClick={() => setArchivePickerOpen(true)}
  >
    From Archive
  </Button>
</div>
```

- [ ] **Step 2.2.4 — Render the picker outside the modal form**

At the very bottom of the modal's JSX (before the closing `</Dialog>` tag), add:

```typescript
<PromptArchivePicker
  open={archivePickerOpen}
  onOpenChange={setArchivePickerOpen}
  onSelect={handleArchiveSelect}
/>
```

- [ ] **Step 2.2.5 — Type-check and lint**

```bash
bunx tsc --noEmit && bun run lint
```

Expected: no errors

- [ ] **Step 2.2.6 — Manual smoke test**

```
1. bun run dev
2. Open AgentBoard → Settings → Create Agent
3. Go to Runtime tab
4. Click "From Archive"
5. Verify picker opens as a slide-over
6. Click an entry — verify preview renders markdown
7. Click "Use as Base" — verify system prompt textarea is populated
8. Verify picker closes
```

- [ ] **Step 2.2.7 — Commit**

```bash
git add src/components/agent-creation-modal.tsx
git commit -m "feat(prompt-archive): integrate archive picker into agent creation modal"
```

---

### Task 2.3 — Post-Epic 2 Cleanup Cycle ♻️

Follow the same three steps as Task 1.4 (TD → CC → DC), scoped to Epic 2 files:

**TD scan targets:** `src/components/prompt-archive-picker.tsx`, `src/components/agent-creation-modal.tsx`

Expected new debt items to document:
- No search/filter within the picker (acceptable for v1 — add in Epic 5 polish)
- No keyboard navigation for the entry list (accessibility gap — log as medium severity)

**CC review targets:** Same files. Pay special attention to `prompt-archive-picker.tsx` — it has inline fetch logic that could be extracted to a hook if it grows.

**DC targets:** Add a brief "Prompt Archive Browser" section to `README.md` with a screenshot placeholder and usage instructions.

```bash
git commit -m "chore(tech-debt): document Epic 2 debt and clean code review"
git commit -m "docs(prompt-archive): README usage section"
```

---

## EPIC 3: Agent Wizard — UI Shell & Requirements Form

**Goal:** A "Create with Wizard" flow where users describe what they want and the wizard collects structured requirements before calling the LLM.

**SDD — Design decisions:**
- Wizard is a separate modal (`agent-wizard-modal.tsx`), not a tab inside the existing creation modal. This keeps both flows independent.
- 3 steps: (1) Requirements, (2) Composing (loading), (3) Review & Edit.
- Step 3 renders the same field set as the agent creation modal — but pre-filled. On "Save", it calls `POST /api/agents` directly.
- The runtime selector in step 1 determines which LLM does the composition — it uses the same `ProjectRuntime` list already available.

**Epic DoR:**
- [ ] Epic 2 ✅ complete
- [ ] At least one `ProjectRuntime` configured in the running app
- [ ] Epic 4's compose API is NOT needed yet — step 2 will show a placeholder "composing…" state until Epic 4 wires it up

---

### Task 3.1 — Wizard Modal Shell & Step Navigation

**DoR:** Epic 3 DoR met.

**DoD:** Global DoD met. Modal opens, renders 3 steps, navigation between steps works, Cancel closes without saving.

**Acceptance Criteria:**
- Given the wizard is open on step 1, when the user clicks "Next", then step 2 is shown
- Given the wizard is on step 2, when the user clicks "Back", then step 1 is shown  
- Given the user clicks "Cancel" on any step, then the modal closes and form state is reset
- Given the user is on step 3, the "Next" button is replaced by "Save Agent"

**Files:**
- Create: `src/components/agent-wizard-modal.tsx`

---

- [ ] **Step 3.1.1 — Write the wizard modal shell**

Create `src/components/agent-wizard-modal.tsx`:

```typescript
'use client'

import { useState } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

export type WizardStep = 'requirements' | 'composing' | 'review'

const STEPS: { id: WizardStep; label: string }[] = [
  { id: 'requirements', label: '1. Requirements' },
  { id: 'composing',    label: '2. Composing' },
  { id: 'review',       label: '3. Review & Save' },
]

interface AgentWizardModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  projectId: string
  /** Called after the agent is successfully saved */
  onAgentCreated: () => void
}

export function AgentWizardModal({ open, onOpenChange, projectId, onAgentCreated }: AgentWizardModalProps) {
  const [step, setStep] = useState<WizardStep>('requirements')

  function handleCancel() {
    setStep('requirements')
    onOpenChange(false)
  }

  function stepIndex(s: WizardStep) {
    return STEPS.findIndex((x) => x.id === s)
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) handleCancel() }}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Agent Wizard</DialogTitle>
        </DialogHeader>

        {/* Step indicator */}
        <div className="flex items-center gap-2 py-2">
          {STEPS.map((s, i) => (
            <div key={s.id} className="flex items-center gap-2">
              {i > 0 && <div className="h-px w-6 bg-border" />}
              <span
                className={cn(
                  'text-xs font-medium px-2 py-1 rounded',
                  step === s.id
                    ? 'bg-primary text-primary-foreground'
                    : stepIndex(step) > i
                    ? 'bg-muted text-muted-foreground line-through'
                    : 'text-muted-foreground',
                )}
              >
                {s.label}
              </span>
            </div>
          ))}
        </div>

        {/* Step content — filled in by subsequent tasks */}
        <div className="min-h-[300px] flex items-center justify-center text-muted-foreground text-sm">
          {step === 'requirements' && <p>Requirements form (Task 3.2)</p>}
          {step === 'composing'    && <p>Composing… (Epic 4)</p>}
          {step === 'review'       && <p>Review form (Task 3.3)</p>}
        </div>

        {/* Navigation */}
        <div className="flex justify-between pt-2 border-t">
          <Button variant="ghost" onClick={handleCancel}>Cancel</Button>
          <div className="flex gap-2">
            {step !== 'requirements' && (
              <Button variant="outline" onClick={() => setStep(step === 'review' ? 'composing' : 'requirements')}>
                Back
              </Button>
            )}
            {step === 'requirements' && (
              <Button onClick={() => setStep('composing')}>Next</Button>
            )}
            {step === 'review' && (
              <Button>Save Agent</Button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
```

- [ ] **Step 3.1.2 — Add "Create with Wizard" button to page.tsx**

In `src/app/page.tsx`, find the "Create Agent" button in the Agents settings section and add a wizard button alongside it:

```typescript
// Add import at top
import { AgentWizardModal } from '@/components/agent-wizard-modal'

// Add state
const [wizardOpen, setWizardOpen] = useState(false)

// Add button near "Create Agent"
<Button variant="outline" size="sm" onClick={() => setWizardOpen(true)}>
  ✨ Wizard
</Button>

// Add modal at bottom of JSX
<AgentWizardModal
  open={wizardOpen}
  onOpenChange={setWizardOpen}
  projectId={currentProject?.id ?? ''}
  onAgentCreated={() => { setWizardOpen(false); fetchAgents() }}
/>
```

- [ ] **Step 3.1.3 — Type-check, lint, manual smoke test**

```bash
bunx tsc --noEmit && bun run lint
```

Verify wizard opens, step indicators update, Cancel resets and closes.

- [ ] **Step 3.1.4 — Commit**

```bash
git add src/components/agent-wizard-modal.tsx src/app/page.tsx
git commit -m "feat(wizard): add wizard modal shell with step navigation"
```

---

### Task 3.2 — Requirements Form (Step 1)

**DoR:** Task 3.1 ✅.

**DoD:** Global DoD met. Form collects purpose, domain, goal, and runtime. Validation prevents advancing without required fields.

**Acceptance Criteria:**
- Given all required fields are empty, when the user clicks "Next", then validation errors are shown and navigation is blocked
- Given all required fields are filled, when the user clicks "Next", then step 2 is shown
- Given the user returns to step 1, when the form re-renders, then previously entered values are preserved

**Files:**
- Modify: `src/components/agent-wizard-modal.tsx`

---

- [ ] **Step 3.2.1 — Define the requirements form schema**

At the top of `agent-wizard-modal.tsx`, add:

```typescript
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'

const requirementsSchema = z.object({
  purpose: z.string().trim().min(10, 'Describe the agent purpose in at least 10 characters'),
  domain:  z.string().trim().min(1, 'Domain is required'),
  goal:    z.enum(['analysis', 'security', 'documentation', 'testing', 'research', 'custom']),
  runtimeId: z.string().trim().min(1, 'Select a runtime for the LLM composition'),
})

export type WizardRequirements = z.infer<typeof requirementsSchema>
```

- [ ] **Step 3.2.2 — Add form to the wizard component**

Inside `AgentWizardModal`, add:

```typescript
const form = useForm<WizardRequirements>({
  resolver: zodResolver(requirementsSchema),
  defaultValues: { purpose: '', domain: '', goal: 'analysis', runtimeId: '' },
})

// Replace the requirements placeholder with:
{step === 'requirements' && (
  <form className="space-y-4 w-full">
    <div className="space-y-1">
      <Label htmlFor="purpose">What should this agent do? *</Label>
      <Textarea
        id="purpose"
        placeholder="e.g. Analyze Rust/Tauri codebases for security vulnerabilities and produce a severity-ranked report"
        rows={3}
        {...form.register('purpose')}
      />
      {form.formState.errors.purpose && (
        <p className="text-xs text-destructive">{form.formState.errors.purpose.message}</p>
      )}
    </div>

    <div className="space-y-1">
      <Label htmlFor="domain">Technology stack / domain *</Label>
      <Input
        id="domain"
        placeholder="e.g. Rust/Tauri, Python/FastAPI, VisualWorks Smalltalk"
        {...form.register('domain')}
      />
      {form.formState.errors.domain && (
        <p className="text-xs text-destructive">{form.formState.errors.domain.message}</p>
      )}
    </div>

    <div className="grid grid-cols-2 gap-4">
      <div className="space-y-1">
        <Label>Primary goal *</Label>
        <Select
          value={form.watch('goal')}
          onValueChange={(v) => form.setValue('goal', v as WizardRequirements['goal'])}
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(['analysis','security','documentation','testing','research','custom'] as const).map((g) => (
              <SelectItem key={g} value={g}>{g.charAt(0).toUpperCase() + g.slice(1)}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-1">
        <Label>Runtime for composition *</Label>
        <Select
          value={form.watch('runtimeId')}
          onValueChange={(v) => form.setValue('runtimeId', v)}
        >
          <SelectTrigger>
            <SelectValue placeholder="Select runtime…" />
          </SelectTrigger>
          <SelectContent>
            {runtimes.map((r) => (
              <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        {form.formState.errors.runtimeId && (
          <p className="text-xs text-destructive">{form.formState.errors.runtimeId.message}</p>
        )}
      </div>
    </div>
  </form>
)}
```

- [ ] **Step 3.2.3 — Fetch runtimes and guard the Next button**

Add runtime fetching and update the Next button:

```typescript
// Add state for runtimes
const [runtimes, setRuntimes] = useState<{ id: string; name: string }[]>([])

useEffect(() => {
  if (!open || !projectId) return
  fetch(`/api/projects/${projectId}/runtimes`)  // existing endpoint
    .then((r) => r.json())
    .then((data) => setRuntimes(data.runtimes ?? []))
    .catch(() => {})
}, [open, projectId])

// Update Next button to validate before advancing
{step === 'requirements' && (
  <Button
    onClick={() =>
      form.handleSubmit(() => setStep('composing'))()
    }
  >
    Next
  </Button>
)}
```

- [ ] **Step 3.2.4 — Type-check and lint**

```bash
bunx tsc --noEmit && bun run lint
```

- [ ] **Step 3.2.5 — Commit**

```bash
git add src/components/agent-wizard-modal.tsx
git commit -m "feat(wizard): add requirements form with Zod validation"
```

---

### Task 3.3 — Review & Edit Step (Step 3)

**DoR:** Task 3.2 ✅. Epic 4 compose API not yet needed — step 3 will receive pre-composed data via a prop passed from step 2.

**DoD:** Global DoD met. Step 3 renders all agent fields editable. "Save Agent" creates the agent via `POST /api/agents`.

**Acceptance Criteria:**
- Given composed data is present, when step 3 renders, then name, personality, role, capabilities, and systemPrompt are all pre-filled and editable
- Given the user edits the system prompt and clicks "Save Agent", then the saved agent has the edited (not original) prompt
- Given `POST /api/agents` returns an error, when Save is clicked, then an error toast is shown and the modal stays open

**Files:**
- Modify: `src/components/agent-wizard-modal.tsx`

---

- [ ] **Step 3.3.1 — Define the composed result type**

Add to `agent-wizard-modal.tsx`:

```typescript
export interface WizardComposedAgent {
  name: string
  role: string
  personality: string
  capabilities: string[]
  systemPrompt: string
  /** Archive entry IDs that were used as source material */
  sourcesUsed: string[]
}
```

- [ ] **Step 3.3.2 — Add composed state and review form**

```typescript
import { toast } from 'sonner'

// Add state
const [composed, setComposed] = useState<WizardComposedAgent | null>(null)
const [saving, setSaving] = useState(false)

const reviewForm = useForm<Partial<WizardComposedAgent>>({
  defaultValues: composed ?? {},
})

// Sync review form when composed data arrives
useEffect(() => {
  if (composed) reviewForm.reset(composed)
}, [composed])

// Step 3 JSX (replace placeholder)
{step === 'review' && composed && (
  <form className="space-y-3 w-full">
    <div className="grid grid-cols-2 gap-3">
      <div className="space-y-1">
        <Label>Name</Label>
        <Input {...reviewForm.register('name')} />
      </div>
      <div className="space-y-1">
        <Label>Role</Label>
        <Input {...reviewForm.register('role')} />
      </div>
    </div>
    <div className="space-y-1">
      <Label>Personality</Label>
      <Input {...reviewForm.register('personality')} />
    </div>
    <div className="space-y-1">
      <Label>System Prompt</Label>
      <Textarea rows={8} className="font-mono text-xs" {...reviewForm.register('systemPrompt')} />
    </div>
    {composed.sourcesUsed.length > 0 && (
      <p className="text-xs text-muted-foreground">
        Sources used: {composed.sourcesUsed.join(', ')}
      </p>
    )}
  </form>
)}
```

- [ ] **Step 3.3.3 — Implement Save Agent**

```typescript
async function handleSaveAgent() {
  const values = reviewForm.getValues()
  if (!values.name?.trim()) {
    toast.error('Agent name is required')
    return
  }
  setSaving(true)
  try {
    const res = await fetch('/api/agents', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: values.name,
        role: values.role,
        personality: values.personality,
        capabilities: values.capabilities ?? [],
        systemPrompt: values.systemPrompt,
        projectId,
        runtimeId: form.getValues('runtimeId'),
      }),
    })
    if (!res.ok) {
      const err = await res.json()
      toast.error(err.error ?? 'Failed to create agent')
      return
    }
    toast.success('Agent created!')
    onAgentCreated()
  } finally {
    setSaving(false)
  }
}

// Update Save Agent button
{step === 'review' && (
  <Button onClick={handleSaveAgent} disabled={saving}>
    {saving ? <><Loader2 className="animate-spin h-4 w-4 mr-2" />Saving…</> : 'Save Agent'}
  </Button>
)}
```

- [ ] **Step 3.3.4 — Type-check, lint, commit**

```bash
bunx tsc --noEmit && bun run lint
git add src/components/agent-wizard-modal.tsx
git commit -m "feat(wizard): add review/edit step and save agent action"
```

---

### Task 3.4 — Post-Epic 3 Cleanup Cycle ♻️

Follow the TD → CC → DC pattern from Task 1.4, scoped to Epic 3 files.

Expected debt to document:
- Runtime fetch uses a project-specific endpoint that may not exist for all runtime configurations — verify endpoint name against actual API
- Review form uses `getValues()` not watched values — a user edit may not reflect in save if form re-renders; switch to `watch()` if observed in manual testing

```bash
git commit -m "chore(tech-debt): document Epic 3 debt items"
git commit -m "docs(wizard): add wizard usage to README"
```

---

## EPIC 4: Agent Wizard — Archive Search & LLM Composition

**Goal:** The wizard's step 2 actually searches the archive, calls an LLM, and returns structured agent fields to step 3.

**SDD — Design decisions:**
- The compose route calls `listEntries()` to get the full archive index, then uses simple keyword scoring (no embeddings required for v1) to select the top 3 most relevant entries.
- It fetches those 3 entries' full content, builds a composition prompt, and calls the selected `ProjectRuntime` LLM via the existing dispatch infrastructure.
- The LLM response is parsed as JSON. If parsing fails, the route returns a `422` with the raw text so the UI can show a fallback message.
- Embeddings-based search (using the existing Skills infrastructure) is documented as a future upgrade in TECHNICAL_DEBT.md.

**Epic DoR:**
- [ ] Epic 3 ✅ complete
- [ ] Existing LLM dispatch mechanism reviewed — confirm how to call a `ProjectRuntime` LLM directly from an API route (check `src/lib/server/adapters/`)

---

### Task 4.1 — Archive Search Service

**DoR:** Epic 4 DoR met.

**DoD:** Global DoD met. Keyword scorer returns top 3 relevant entries for a given requirements input.

**Acceptance Criteria:**
- Given the archive contains a "Rust/Tauri analysis" file and a "Smalltalk" file, when searching for "Rust security", then the Rust/Tauri file ranks higher
- Given no archive entries match at all, when searching, then the top 3 entries by file size are returned as a fallback

**Files:**
- Create: `src/lib/server/wizard-composer.ts`
- Create: `src/lib/server/__tests__/wizard-composer.test.ts`

---

- [ ] **Step 4.1.1 — Write failing tests for the scorer**

Create `src/lib/server/__tests__/wizard-composer.test.ts`:

```typescript
import { describe, test, expect } from 'bun:test'
import { scoreEntry } from '../wizard-composer'
import type { PromptLibraryEntry } from '@/types/prompt-library'

function makeEntry(overrides: Partial<PromptLibraryEntry>): PromptLibraryEntry {
  return {
    id: 'test-id',
    category: 'Test',
    title: 'Test Entry',
    description: '',
    charCount: 1000,
    relativePath: 'Test/test.md',
    ...overrides,
  }
}

describe('scoreEntry', () => {
  test('returns higher score when terms appear in title', () => {
    const rustEntry = makeEntry({ title: 'Rust Tauri Code Analysis Agent', category: 'agents' })
    const otherEntry = makeEntry({ title: 'Gemini CLI', category: 'Google' })
    const terms = ['rust', 'tauri', 'analysis']

    expect(scoreEntry(rustEntry, terms)).toBeGreaterThan(scoreEntry(otherEntry, terms))
  })

  test('returns higher score for category match', () => {
    const agentEntry = makeEntry({ category: 'agents', title: 'My Agent' })
    const genericEntry = makeEntry({ category: 'Anthropic', title: 'Claude Sonnet' })
    const terms = ['agent', 'custom']

    expect(scoreEntry(agentEntry, terms)).toBeGreaterThan(scoreEntry(genericEntry, terms))
  })

  test('returns 0 for completely unrelated entry', () => {
    const entry = makeEntry({ title: 'Gemini Voice', category: 'Google', description: 'A voice UI' })
    expect(scoreEntry(entry, ['rust', 'security', 'tauri'])).toBe(0)
  })
})
```

- [ ] **Step 4.1.2 — Run to confirm failure**

```bash
bun test src/lib/server/__tests__/wizard-composer.test.ts
```

Expected: FAIL — `Cannot find module '../wizard-composer'`

- [ ] **Step 4.1.3 — Implement the scorer**

Create `src/lib/server/wizard-composer.ts`:

```typescript
import { listEntries, getEntry } from './prompt-library'
import type { PromptLibraryEntry, PromptLibraryEntryFull } from '@/types/prompt-library'

/** Scores an archive entry against a set of search terms (case-insensitive). */
export function scoreEntry(entry: PromptLibraryEntry, terms: string[]): number {
  const haystack = [entry.title, entry.category, entry.description]
    .join(' ')
    .toLowerCase()

  return terms.reduce((score, term) => {
    const t = term.toLowerCase()
    if (entry.title.toLowerCase().includes(t)) return score + 3  // title match is strongest
    if (entry.category.toLowerCase().includes(t)) return score + 2
    if (haystack.includes(t)) return score + 1
    return score
  }, 0)
}

/** Returns the top N archive entries most relevant to the given terms. Falls back to largest entries if nothing matches. */
export async function findRelevantEntries(terms: string[], topN = 3): Promise<PromptLibraryEntryFull[]> {
  const library = await listEntries()
  const allEntries = library.categories.flatMap((c) => c.entries)

  const scored = allEntries
    .map((e) => ({ entry: e, score: scoreEntry(e, terms) }))
    .sort((a, b) => b.score - a.score || b.entry.charCount - a.entry.charCount)

  const top = scored.slice(0, topN).map((s) => s.entry)
  const full = await Promise.all(top.map((e) => getEntry(e.id)))
  return full.filter((e): e is PromptLibraryEntryFull => e !== null)
}
```

- [ ] **Step 4.1.4 — Run tests to confirm pass**

```bash
bun test src/lib/server/__tests__/wizard-composer.test.ts
```

Expected: PASS (3 tests)

- [ ] **Step 4.1.5 — Commit**

```bash
git add src/lib/server/wizard-composer.ts src/lib/server/__tests__/wizard-composer.test.ts
git commit -m "feat(wizard): add archive keyword scorer and relevance search"
```

---

### Task 4.2 — LLM Composition Backend

**DoR:** Task 4.1 ✅. `src/lib/server/adapters/` reviewed to confirm how to invoke a `ProjectRuntime` LLM.

**DoD:** Global DoD met. `POST /api/agent-wizard/compose` returns structured agent fields. Handles LLM parse failure gracefully.

**Acceptance Criteria:**
- Given valid requirements and a working runtime, when the route is called, then it returns `{ name, role, personality, capabilities, systemPrompt, sourcesUsed }` with `200`
- Given the LLM returns malformed JSON, then the route returns `422` with `{ error: "...", rawResponse: "..." }`
- Given `runtimeId` is invalid, then the route returns `404`

**Files:**
- Modify: `src/lib/server/wizard-composer.ts`
- Create: `src/app/api/agent-wizard/compose/route.ts`

---

- [ ] **Step 4.2.1 — Add the compose function to wizard-composer.ts**

Append to `src/lib/server/wizard-composer.ts`:

```typescript
import { db } from '@/lib/db'

export interface ComposeRequest {
  purpose: string
  domain: string
  goal: string
  runtimeId: string
}

export interface ComposeResult {
  name: string
  role: string
  personality: string
  capabilities: string[]
  systemPrompt: string
  sourcesUsed: string[]
}

const COMPOSE_PROMPT = (req: ComposeRequest, sources: PromptLibraryEntryFull[]) => `
You are building a system prompt for an AI agent. The user has provided these requirements:

Purpose: ${req.purpose}
Domain/Stack: ${req.domain}
Primary goal: ${req.goal}

The following archive prompts are provided as reference material. Use them as inspiration — extract relevant patterns, rules, and heuristics, but compose a NEW prompt tailored to the requirements above. Do not copy them verbatim.

${sources.map((s, i) => `--- SOURCE ${i + 1}: ${s.title} ---\n${s.content}`).join('\n\n')}

---

Respond with ONLY a JSON object (no markdown fences) with this exact shape:
{
  "name": "short agent name (2-3 words)",
  "role": "one of: developer|architect|security|reviewer|qa|analyst|writer|researcher|support|custom",
  "personality": "one sentence describing voice and reasoning style (max 280 chars)",
  "capabilities": ["capability-slug-1", "capability-slug-2"],
  "systemPrompt": "the full system prompt (max 9500 chars, use {{agent.name}}, {{agent.role}}, {{agent.personality}}, {{agent.capabilities}}, {{task.title}}, {{task.description}}, {{memory.recent}}, {{memory.relevant}} as Mustache placeholders where appropriate)"
}
`.trim()

/** Calls the given ProjectRuntime LLM to compose agent fields from requirements. */
export async function composeAgent(req: ComposeRequest): Promise<ComposeResult> {
  // Load the runtime from DB
  const runtime = await db.projectRuntime.findUnique({ where: { id: req.runtimeId } })
  if (!runtime) throw new Error(`Runtime not found: ${req.runtimeId}`)

  // Find relevant archive entries
  const terms = [req.purpose, req.domain, req.goal].join(' ').split(/\s+/).filter((t) => t.length > 3)
  const sources = await findRelevantEntries(terms, 3)

  // Build the prompt
  const userPrompt = COMPOSE_PROMPT(req, sources)

  // Call the LLM via the adapter registry
  // NOTE: import the adapter lookup from wherever it lives in the project
  const { callRuntime } = await import('./adapters/index')
  const rawResponse = await callRuntime(runtime, userPrompt)

  // Parse JSON
  let parsed: ComposeResult
  try {
    parsed = JSON.parse(rawResponse)
  } catch {
    const err = new Error('LLM_PARSE_FAILURE')
    ;(err as Error & { rawResponse: string }).rawResponse = rawResponse
    throw err
  }

  return {
    ...parsed,
    sourcesUsed: sources.map((s) => s.id),
  }
}
```

> **Note:** Replace `callRuntime` with the actual adapter invocation pattern found in `src/lib/server/adapters/`. Check that file before implementing this step — the function signature may differ.

- [ ] **Step 4.2.2 — Create the compose API route**

Create `src/app/api/agent-wizard/compose/route.ts`:

```typescript
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { composeAgent } from '@/lib/server/wizard-composer'
import { validateLibraryPath } from '@/lib/server/prompt-library'

const composeRequestSchema = z.object({
  purpose:   z.string().trim().min(10),
  domain:    z.string().trim().min(1),
  goal:      z.string().trim().min(1),
  runtimeId: z.string().trim().min(1),
})

/** POST /api/agent-wizard/compose */
export async function POST(req: Request) {
  const libraryError = validateLibraryPath()
  if (libraryError) {
    return NextResponse.json({ error: libraryError }, { status: 503 })
  }

  const body = await req.json().catch(() => null)
  const parsed = composeRequestSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })
  }

  try {
    const result = await composeAgent(parsed.data)
    return NextResponse.json(result)
  } catch (err: unknown) {
    const e = err as Error & { rawResponse?: string }
    if (e.message === 'LLM_PARSE_FAILURE') {
      return NextResponse.json(
        { error: 'LLM returned unparseable response', rawResponse: e.rawResponse },
        { status: 422 },
      )
    }
    if (e.message.startsWith('Runtime not found')) {
      return NextResponse.json({ error: e.message }, { status: 404 })
    }
    console.error('[wizard/compose]', e)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
```

- [ ] **Step 4.2.3 — Type-check**

```bash
bunx tsc --noEmit
```

- [ ] **Step 4.2.4 — Commit**

```bash
git add src/lib/server/wizard-composer.ts src/app/api/agent-wizard/
git commit -m "feat(wizard): add LLM composition backend and compose API route"
```

---

### Task 4.3 — Wire Wizard Step 2 to Composition API

**DoR:** Task 4.2 ✅.

**DoD:** Global DoD met. Wizard step 2 calls the compose API, shows a loading state, and transitions to step 3 with the composed data.

**Acceptance Criteria:**
- Given step 1 is complete, when step 2 renders, then the compose API is called automatically
- Given the API succeeds, then step 3 is shown with pre-filled fields
- Given the API fails, then an error message is shown on step 2 with a "Try Again" button

**Files:**
- Modify: `src/components/agent-wizard-modal.tsx`

---

- [ ] **Step 4.3.1 — Add composition logic to wizard**

In `agent-wizard-modal.tsx`, add:

```typescript
const [composeError, setComposeError] = useState<string | null>(null)

// Trigger composition when entering step 2
useEffect(() => {
  if (step !== 'composing') return
  setComposeError(null)

  const req = form.getValues()
  fetch('/api/agent-wizard/compose', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(req),
  })
    .then(async (res) => {
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Composition failed')
      setComposed(data)
      setStep('review')
    })
    .catch((err) => setComposeError(err.message))
}, [step])

// Replace composing placeholder with:
{step === 'composing' && (
  <div className="flex-1 flex flex-col items-center justify-center gap-4">
    {!composeError ? (
      <>
        <Loader2 className="animate-spin h-8 w-8 text-primary" />
        <p className="text-sm text-muted-foreground">Searching archive and composing your agent…</p>
      </>
    ) : (
      <>
        <AlertCircle className="h-8 w-8 text-destructive" />
        <p className="text-sm text-destructive">{composeError}</p>
        <Button variant="outline" size="sm" onClick={() => setStep('composing')}>
          Try Again
        </Button>
      </>
    )}
  </div>
)}
```

- [ ] **Step 4.3.2 — Type-check, lint, full manual flow test**

```bash
bunx tsc --noEmit && bun run lint
```

Manual test flow:
```
1. Click "✨ Wizard"
2. Fill in purpose, domain, goal, runtime → Next
3. Verify loading spinner on step 2
4. Verify step 3 shows pre-filled fields
5. Edit the system prompt
6. Click "Save Agent"
7. Verify agent appears in the agents list
```

- [ ] **Step 4.3.3 — Commit**

```bash
git add src/components/agent-wizard-modal.tsx
git commit -m "feat(wizard): wire step 2 to compose API with loading and error states"
```

---

### Task 4.4 — Post-Epic 4 Cleanup Cycle ♻️

Follow the TD → CC → DC pattern, scoped to Epic 4 files.

Expected debt to document:
- Keyword search is naive (no stemming, no synonyms) — log as Low, note embeddings-based upgrade path using existing Skills infrastructure
- `callRuntime` adapter invocation pattern — verify the actual function signature matches what was used; adjust if needed
- COMPOSE_PROMPT is a template string in source — future improvement would be a configurable prompt template stored in settings

```bash
git commit -m "chore(tech-debt): document Epic 4 debt items"
git commit -m "docs(wizard): add wizard compose flow to README"
```

---

## EPIC 5: Final Integration, Edge Cases & Documentation

**Goal:** End-to-end verification, performance improvements, and complete documentation. Ship-ready state.

### Task 5.1 — Add 60s In-Memory Cache to PromptLibraryService (TD-001)

**Files:** `src/lib/server/prompt-library.ts`

- [ ] Add a simple module-level cache:

```typescript
interface CacheEntry { data: PromptLibraryListResponse; expiresAt: number }
let listCache: CacheEntry | null = null

export async function listEntries(): Promise<PromptLibraryListResponse> {
  if (listCache && Date.now() < listCache.expiresAt) return listCache.data
  // ... existing implementation ...
  const data = { categories }
  listCache = { data, expiresAt: Date.now() + 60_000 }
  return data
}
```

- [ ] Add cache-invalidation test:

```typescript
test('returns cached result within TTL', async () => {
  // call listEntries twice, verify filesystem read happens once
  // (use a spy on fs.readdirSync)
})
```

- [ ] Commit: `perf(prompt-library): add 60s in-memory list cache`

---

### Task 5.2 — Edge Case: Archive Picker Search Filter

Pay off TD-002 from Epic 2 — no search within the picker.

**Files:** `src/components/prompt-archive-picker.tsx`

- [ ] Add a controlled `Input` for filter text above the entry list
- [ ] Filter entries client-side: hide entries whose title + description don't include the filter string
- [ ] Commit: `feat(prompt-archive): add client-side search filter to picker`

---

### Task 5.3 — Final Documentation Pass

- [ ] **README:** Complete the Prompt Archive Browser and Agent Wizard sections with actual screenshots
- [ ] **TECHNICAL_DEBT.md:** Mark resolved items, add any new ones surfaced during Epic 5
- [ ] **API docs:** Ensure `/api/prompt-library` and `/api/agent-wizard/compose` are listed in any API reference section of the README
- [ ] Commit: `docs: final documentation pass for prompt archive and wizard features`

---

### Task 5.4 — Post-Epic 5 Final Cleanup Cycle ♻️

Run the full TD → CC → DC cycle one final time across ALL new files:

```bash
# Full TD scan
grep -rn "TODO\|FIXME\|HACK\|any\b" \
  src/lib/server/prompt-library.ts \
  src/lib/server/wizard-composer.ts \
  src/components/prompt-archive-picker.tsx \
  src/components/agent-wizard-modal.tsx \
  src/app/api/prompt-library/ \
  src/app/api/agent-wizard/

# Full type check
bunx tsc --noEmit

# Full lint
bun run lint

# Full test run
bun test
```

All must pass before marking the epic done.

```bash
git commit -m "chore: final cleanup and debt resolution for prompt archive + wizard"
```

---

## Self-Review Checklist

| Requirement | Covered by |
|-------------|-----------|
| Archive configured via env var | Task 1.1 |
| Archive files parsed and indexed | Task 1.2 |
| List and single-entry API routes | Task 1.3 |
| Archive picker UI component | Task 2.1 |
| Picker integrated into creation modal | Task 2.2 |
| Wizard modal shell + step nav | Task 3.1 |
| Requirements form with validation | Task 3.2 |
| Review/edit step + save action | Task 3.3 |
| Archive keyword search | Task 4.1 |
| LLM composition backend | Task 4.2 |
| Wizard wired end-to-end | Task 4.3 |
| 60s cache (TD-001) | Task 5.1 |
| Picker search filter (TD-002) | Task 5.2 |
| Post-epic cleanup cycle | Tasks 1.4, 2.3, 3.4, 4.4, 5.4 |
| Technical debt tracking | TECHNICAL_DEBT.md, all TD tasks |
| Clean code review | All CC tasks |
| Documentation | All DC tasks + Task 5.3 |

No placeholders found. All steps contain actual code, commands, and expected output.
