import { describe, test, expect, beforeEach, afterEach } from 'bun:test'

import { isSafeExternalUrl } from '../url-safety'

// ---------------------------------------------------------------------------
// No mocks needed — isSafeExternalUrl is a pure function that consults
// process.env.AGENTBOARD_ALLOW_LOCAL_WEBHOOK. We snapshot and restore it
// per-test so a developer running with it set doesn't poison the suite.
// ---------------------------------------------------------------------------

let originalEnvFlag: string | undefined

beforeEach(() => {
  originalEnvFlag = process.env.AGENTBOARD_ALLOW_LOCAL_WEBHOOK
  delete process.env.AGENTBOARD_ALLOW_LOCAL_WEBHOOK
})

afterEach(() => {
  if (originalEnvFlag === undefined) {
    delete process.env.AGENTBOARD_ALLOW_LOCAL_WEBHOOK
  } else {
    process.env.AGENTBOARD_ALLOW_LOCAL_WEBHOOK = originalEnvFlag
  }
})

// ===========================================================================
// Public URLs
// ===========================================================================

describe('isSafeExternalUrl — allows public URLs', () => {
  test('https with a public hostname', () => {
    const r = isSafeExternalUrl('https://example.com/webhook')
    expect(r.ok).toBe(true)
  })

  test('http with a public hostname and port', () => {
    const r = isSafeExternalUrl('http://example.com:8080/hook')
    expect(r.ok).toBe(true)
  })

  test('public IPv4 (8.8.8.8)', () => {
    const r = isSafeExternalUrl('https://8.8.8.8/')
    expect(r.ok).toBe(true)
  })
})

// ===========================================================================
// IPv4 private / loopback / link-local ranges
// ===========================================================================

describe('isSafeExternalUrl — rejects IPv4 private ranges', () => {
  test('127.0.0.1 (loopback) is rejected', () => {
    const r = isSafeExternalUrl('http://127.0.0.1:3000/')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toMatch(/IPv4/)
  })

  test('169.254.169.254 (AWS IMDS) is rejected', () => {
    const r = isSafeExternalUrl('http://169.254.169.254/latest/meta-data/')
    expect(r.ok).toBe(false)
  })

  test('10.x.x.x is rejected', () => {
    const r = isSafeExternalUrl('http://10.0.0.5/')
    expect(r.ok).toBe(false)
  })

  test('172.16.x.x is rejected, 172.15 is not, 172.32 is not', () => {
    expect(isSafeExternalUrl('http://172.16.0.1/').ok).toBe(false)
    expect(isSafeExternalUrl('http://172.31.255.254/').ok).toBe(false)
    expect(isSafeExternalUrl('http://172.15.0.1/').ok).toBe(true)
    expect(isSafeExternalUrl('http://172.32.0.1/').ok).toBe(true)
  })

  test('192.168.x.x is rejected', () => {
    const r = isSafeExternalUrl('http://192.168.1.1/')
    expect(r.ok).toBe(false)
  })

  test('0.0.0.0 is rejected', () => {
    const r = isSafeExternalUrl('http://0.0.0.0/')
    expect(r.ok).toBe(false)
  })

  test('100.64.x.x (CGNAT) is rejected', () => {
    const r = isSafeExternalUrl('http://100.64.1.1/')
    expect(r.ok).toBe(false)
  })
})

// ===========================================================================
// Hostname keyword blocks
// ===========================================================================

describe('isSafeExternalUrl — rejects localhost aliases', () => {
  test('localhost is rejected', () => {
    const r = isSafeExternalUrl('http://localhost:3000/')
    expect(r.ok).toBe(false)
  })

  test('LOCALHOST (case-insensitive) is rejected', () => {
    const r = isSafeExternalUrl('http://LOCALHOST:3000/')
    expect(r.ok).toBe(false)
  })
})

// ===========================================================================
// IPv6 ranges
// ===========================================================================

describe('isSafeExternalUrl — rejects IPv6 loopback and ranges', () => {
  test('::1 (IPv6 loopback) is rejected', () => {
    const r = isSafeExternalUrl('http://[::1]/')
    expect(r.ok).toBe(false)
  })

  test('::ffff:127.0.0.1 (IPv4-mapped) is rejected', () => {
    const r = isSafeExternalUrl('http://[::ffff:127.0.0.1]/')
    expect(r.ok).toBe(false)
  })

  test('fe80:: (link-local) is rejected', () => {
    const r = isSafeExternalUrl('http://[fe80::1]/')
    expect(r.ok).toBe(false)
  })

  test('fc00:: (unique local) is rejected', () => {
    const r = isSafeExternalUrl('http://[fc00::1]/')
    expect(r.ok).toBe(false)
  })
})

// ===========================================================================
// Protocol, malformed URL
// ===========================================================================

describe('isSafeExternalUrl — input validation', () => {
  test('file:// is rejected', () => {
    const r = isSafeExternalUrl('file:///etc/passwd')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toMatch(/protocol/i)
  })

  test('gopher:// is rejected', () => {
    const r = isSafeExternalUrl('gopher://example.com/')
    expect(r.ok).toBe(false)
  })

  test('garbage string is rejected', () => {
    const r = isSafeExternalUrl('not a url at all')
    expect(r.ok).toBe(false)
  })
})

// ===========================================================================
// Env override
// ===========================================================================

describe('isSafeExternalUrl — AGENTBOARD_ALLOW_LOCAL_WEBHOOK override', () => {
  test('with flag set, localhost is allowed', () => {
    process.env.AGENTBOARD_ALLOW_LOCAL_WEBHOOK = '1'
    const r = isSafeExternalUrl('http://localhost:3000/')
    expect(r.ok).toBe(true)
  })

  test('with flag set, 169.254 is allowed (developer responsibility)', () => {
    process.env.AGENTBOARD_ALLOW_LOCAL_WEBHOOK = '1'
    const r = isSafeExternalUrl('http://169.254.169.254/')
    expect(r.ok).toBe(true)
  })

  test('with flag set to something other than "1", the guard stays active', () => {
    process.env.AGENTBOARD_ALLOW_LOCAL_WEBHOOK = 'yes'
    const r = isSafeExternalUrl('http://localhost:3000/')
    expect(r.ok).toBe(false)
  })
})
