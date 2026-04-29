import { describe, test, expect, afterEach } from 'bun:test'

describe('getLibraryPath', () => {
  const ORIGINAL = process.env.PROMPT_LIBRARY_PATH

  afterEach(() => {
    if (ORIGINAL === undefined) {
      delete process.env.PROMPT_LIBRARY_PATH
    } else {
      process.env.PROMPT_LIBRARY_PATH = ORIGINAL
    }
  })

  test('returns null when env var is unset', async () => {
    delete process.env.PROMPT_LIBRARY_PATH
    // Clear module cache so re-import picks up env change
    const mod = await import('../prompt-library')
    expect(mod.getLibraryPath()).toBeNull()
  })

  test('returns the configured path when set', async () => {
    process.env.PROMPT_LIBRARY_PATH = '/tmp/test-archive'
    const mod = await import('../prompt-library')
    expect(mod.getLibraryPath()).toBe('/tmp/test-archive')
  })
})
