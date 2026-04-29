import { describe, test, expect, afterEach, beforeEach } from 'bun:test'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { getLibraryPath, validateLibraryPath, listEntries, getEntry } from '../prompt-library'

describe('getLibraryPath', () => {
  let original: string | undefined
  beforeEach(() => { original = process.env.PROMPT_LIBRARY_PATH })
  afterEach(() => {
    if (original === undefined) delete process.env.PROMPT_LIBRARY_PATH
    else process.env.PROMPT_LIBRARY_PATH = original
  })

  test('returns null when env var is unset', () => {
    delete process.env.PROMPT_LIBRARY_PATH
    expect(getLibraryPath()).toBeNull()
  })

  test('returns the configured path when set', () => {
    process.env.PROMPT_LIBRARY_PATH = '/tmp/test-archive'
    expect(getLibraryPath()).toBe('/tmp/test-archive')
  })
})

describe('validateLibraryPath', () => {
  let original: string | undefined
  beforeEach(() => { original = process.env.PROMPT_LIBRARY_PATH })
  afterEach(() => {
    if (original === undefined) delete process.env.PROMPT_LIBRARY_PATH
    else process.env.PROMPT_LIBRARY_PATH = original
  })

  test('returns error string when env var is unset', () => {
    delete process.env.PROMPT_LIBRARY_PATH
    expect(validateLibraryPath()).toBe('Prompt library not configured')
  })

  test('returns error string when path does not exist on disk', () => {
    process.env.PROMPT_LIBRARY_PATH = '/nonexistent/path/that/does/not/exist'
    const result = validateLibraryPath()
    expect(result).not.toBeNull()
    expect(result).toContain('/nonexistent/path/that/does/not/exist')
  })

  test('returns null when path exists on disk', () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'agentboard-test-'))
    try {
      process.env.PROMPT_LIBRARY_PATH = tmpDir
      expect(validateLibraryPath()).toBeNull()
    } finally {
      rmSync(tmpDir, { recursive: true, force: true })
    }
  })
})

describe('listEntries', () => {
  let tmpDir: string
  let original: string | undefined

  beforeEach(() => {
    original = process.env.PROMPT_LIBRARY_PATH
    tmpDir = mkdtempSync(join(tmpdir(), 'agentboard-list-test-'))
    process.env.PROMPT_LIBRARY_PATH = tmpDir
  })

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true })
    if (original === undefined) delete process.env.PROMPT_LIBRARY_PATH
    else process.env.PROMPT_LIBRARY_PATH = original
  })

  test('basic: returns entries under the correct category with extracted titles, sorted alphabetically', () => {
    mkdirSync(join(tmpDir, 'agents'))
    writeFileSync(join(tmpDir, 'agents', 'researcher.md'), '# Research Agent\n\nThis agent researches topics.\n')
    writeFileSync(join(tmpDir, 'agents', 'assistant.md'), '# Assistant Agent\n\nThis agent assists users.\n')

    const result = listEntries()

    expect(result.categories).toHaveLength(1)
    expect(result.categories[0].name).toBe('agents')
    expect(result.categories[0].entries).toHaveLength(2)
    // sorted alphabetically: "Assistant Agent" before "Research Agent"
    expect(result.categories[0].entries[0].title).toBe('Assistant Agent')
    expect(result.categories[0].entries[1].title).toBe('Research Agent')
    // verify category on each entry
    expect(result.categories[0].entries[0].category).toBe('agents')
    expect(result.categories[0].entries[0].relativePath).toBe('agents/assistant.md')
  })

  test('skips hidden directories and hidden files within visible categories', () => {
    mkdirSync(join(tmpDir, 'visible'))
    mkdirSync(join(tmpDir, '.hidden'))
    writeFileSync(join(tmpDir, 'visible', 'good.md'), '# Good Prompt\n\nContent here.\n')
    writeFileSync(join(tmpDir, 'visible', '.hidden.md'), '# Hidden File\n\nShould be skipped.\n')
    writeFileSync(join(tmpDir, '.hidden', 'secret.md'), '# Secret\n\nShould not appear.\n')

    const result = listEntries()

    expect(result.categories).toHaveLength(1)
    expect(result.categories[0].name).toBe('visible')
    expect(result.categories[0].entries).toHaveLength(1)
    expect(result.categories[0].entries[0].title).toBe('Good Prompt')
  })

  test('sorts categories alphabetically (case-insensitive)', () => {
    mkdirSync(join(tmpDir, 'zebra'))
    mkdirSync(join(tmpDir, 'apple'))
    writeFileSync(join(tmpDir, 'zebra', 'z-prompt.md'), '# Zebra Prompt\n\nContent.\n')
    writeFileSync(join(tmpDir, 'apple', 'a-prompt.md'), '# Apple Prompt\n\nContent.\n')

    const result = listEntries()

    expect(result.categories).toHaveLength(2)
    expect(result.categories[0].name).toBe('apple')
    expect(result.categories[1].name).toBe('zebra')
  })

  test('places root-level .md files in category "" sorted last', () => {
    const tmpDir2 = mkdtempSync(join(tmpdir(), 'pl-root-'))
    const catDir = join(tmpDir2, 'alpha')
    mkdirSync(catDir)
    writeFileSync(join(catDir, 'a.md'), '# Alpha Entry\nAlpha desc.')
    writeFileSync(join(tmpDir2, 'root.md'), '# Root Entry\nRoot desc.')
    process.env.PROMPT_LIBRARY_PATH = tmpDir2
    try {
      const result = listEntries()
      expect(result.categories[0].name).toBe('alpha')
      expect(result.categories[1].name).toBe('')
      expect(result.categories[1].entries[0].title).toBe('Root Entry')
    } finally {
      delete process.env.PROMPT_LIBRARY_PATH
      rmSync(tmpDir2, { recursive: true, force: true })
    }
  })
})

describe('getEntry', () => {
  let tmpDir: string
  let original: string | undefined

  beforeEach(() => {
    original = process.env.PROMPT_LIBRARY_PATH
    tmpDir = mkdtempSync(join(tmpdir(), 'agentboard-get-test-'))
    process.env.PROMPT_LIBRARY_PATH = tmpDir
  })

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true })
    if (original === undefined) delete process.env.PROMPT_LIBRARY_PATH
    else process.env.PROMPT_LIBRARY_PATH = original
  })

  test('returns full entry with content when file exists', () => {
    mkdirSync(join(tmpDir, 'category'))
    writeFileSync(join(tmpDir, 'category', 'file.md'), '# My Prompt\n\nThis is the description.\n')

    const id = Buffer.from('category/file.md').toString('base64url')
    const entry = getEntry(id)

    expect(entry).not.toBeNull()
    expect(entry!.title).toBe('My Prompt')
    expect(entry!.content).toContain('# My Prompt')
    expect(entry!.truncated).toBe(false)
    expect(entry!.relativePath).toBe('category/file.md')
    expect(entry!.category).toBe('category')
  })

  test('truncates content longer than MAX_PROMPT_CONTENT_CHARS and appends notice', () => {
    mkdirSync(join(tmpDir, 'bigcat'))
    // 10_000 'a' characters ensures content far exceeds 9500
    const longContent = '# Big Prompt\n\n' + 'a'.repeat(10_000)
    writeFileSync(join(tmpDir, 'bigcat', 'big.md'), longContent)

    const id = Buffer.from('bigcat/big.md').toString('base64url')
    const entry = getEntry(id)

    expect(entry).not.toBeNull()
    expect(entry!.truncated).toBe(true)
    // content should be shorter than the original (9500 chars of text + short notice < 10015 original)
    expect(entry!.content.length).toBeLessThan(longContent.length)
    expect(entry!.content).toContain('[Content truncated to 9500 characters]')
  })

  test('returns null when the file does not exist', () => {
    const id = Buffer.from('nonexistent/file.md').toString('base64url')
    const entry = getEntry(id)
    expect(entry).toBeNull()
  })
})
