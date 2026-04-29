import { describe, test, expect, afterEach, beforeEach } from 'bun:test'
import { mkdtempSync, rmdirSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { getLibraryPath, validateLibraryPath } from '../prompt-library'

describe('getLibraryPath', () => {
  const ORIGINAL = process.env.PROMPT_LIBRARY_PATH

  afterEach(() => {
    if (ORIGINAL === undefined) {
      delete process.env.PROMPT_LIBRARY_PATH
    } else {
      process.env.PROMPT_LIBRARY_PATH = ORIGINAL
    }
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
  const ORIGINAL = process.env.PROMPT_LIBRARY_PATH

  afterEach(() => {
    if (ORIGINAL === undefined) {
      delete process.env.PROMPT_LIBRARY_PATH
    } else {
      process.env.PROMPT_LIBRARY_PATH = ORIGINAL
    }
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
      rmdirSync(tmpDir)
    }
  })
})
