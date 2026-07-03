import { describe, test, expect, mock, beforeEach, afterEach } from 'bun:test'

// NOTE: import the real module directly. This file sorts before
// reaction-executor.test.ts (which mock.module's this path), and the direct
// function reference captured here survives later registry mutations —
// Bun's module registry is shared across test files.
import { executeHttpReaction } from '../reactions/types/http'

// executeHttpReaction consults global fetch and isSafeExternalUrl (a pure
// function that only reads AGENTBOARD_ALLOW_LOCAL_WEBHOOK). Stub fetch and
// pin the env var so results don't depend on the developer's shell.

const originalFetch = globalThis.fetch
const originalAllowLocal = process.env.AGENTBOARD_ALLOW_LOCAL_WEBHOOK

const mockFetch = mock(() =>
  Promise.resolve(new Response('{}', { status: 200, statusText: 'OK' })),
) as any

beforeEach(() => {
  delete process.env.AGENTBOARD_ALLOW_LOCAL_WEBHOOK
  mockFetch.mockClear()
  mockFetch.mockResolvedValue(new Response('{}', { status: 200, statusText: 'OK' }))
  globalThis.fetch = mockFetch as unknown as typeof fetch
})

afterEach(() => {
  globalThis.fetch = originalFetch
  if (originalAllowLocal === undefined) {
    delete process.env.AGENTBOARD_ALLOW_LOCAL_WEBHOOK
  } else {
    process.env.AGENTBOARD_ALLOW_LOCAL_WEBHOOK = originalAllowLocal
  }
})

describe('executeHttpReaction — SSRF guard', () => {
  test('rejects the AWS metadata endpoint and never fetches', async () => {
    await expect(
      executeHttpReaction({ url: 'https://169.254.169.254/latest/meta-data/' }),
    ).rejects.toThrow(/post:http URL rejected/)
    expect(mockFetch).not.toHaveBeenCalled()
  })

  test('rejects localhost and never fetches', async () => {
    await expect(
      executeHttpReaction({ url: 'https://localhost:3000/hook' }),
    ).rejects.toThrow(/post:http URL rejected/)
    expect(mockFetch).not.toHaveBeenCalled()
  })

  test('rejects RFC1918 private ranges and never fetches', async () => {
    await expect(executeHttpReaction({ url: 'https://10.0.0.5/hook' })).rejects.toThrow(
      /post:http URL rejected/,
    )
    await expect(executeHttpReaction({ url: 'https://192.168.1.1/hook' })).rejects.toThrow(
      /post:http URL rejected/,
    )
    await expect(executeHttpReaction({ url: 'https://172.16.0.1/hook' })).rejects.toThrow(
      /post:http URL rejected/,
    )
    expect(mockFetch).not.toHaveBeenCalled()
  })

  test('surfaces the guard reason in the error message', async () => {
    await expect(
      executeHttpReaction({ url: 'https://169.254.169.254/' }),
    ).rejects.toThrow(/link-local/)
  })

  test('still rejects non-https URLs (existing behaviour)', async () => {
    await expect(executeHttpReaction({ url: 'http://example.com/hook' })).rejects.toThrow(
      /only allows https/,
    )
    expect(mockFetch).not.toHaveBeenCalled()
  })

  test('allows a public https URL through to fetch', async () => {
    const result = await executeHttpReaction({
      url: 'https://example.com/hook',
      body: { hello: 'world' },
    })

    expect(result).toEqual({ status: 200, ok: true })
    expect(mockFetch).toHaveBeenCalledTimes(1)
    expect((mockFetch.mock.calls[0] as unknown[])[0]).toBe('https://example.com/hook')
  })
})
