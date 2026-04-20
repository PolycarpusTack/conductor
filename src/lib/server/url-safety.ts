import { isIP } from 'net'

// =============================================================================
// SSRF guard for outbound admin-configured URLs (webhook runtime adapters, and
// any future feature that accepts a URL from an admin and POSTs task data to
// it). An admin with access to runtime configuration could otherwise point a
// task at `http://169.254.169.254/` (AWS IMDS), `http://localhost:5432/`, or
// an internal service and exfiltrate the task's system prompt + context +
// previous step output.
//
// Gaps this guard DOES NOT close:
//   • DNS rebinding. We check the literal hostname, but if the hostname is a
//     public DNS name that resolves to a private IP between check and fetch,
//     we'll still POST. A proper fix requires resolving the host once,
//     pinning the resolved IP, and setting the Host header manually — which
//     is a significant chunk of code we don't need yet. Document the gap and
//     move on.
//   • IPv6 zone identifiers / IPv4-mapped IPv6 edge cases are handled
//     conservatively: anything that looks suspicious is rejected.
//   • Outbound proxy / egress firewall rules at the infrastructure layer are
//     the production-grade solution. This guard is defense in depth.
//
// Set AGENTBOARD_ALLOW_LOCAL_WEBHOOK=1 to bypass the guard entirely — useful
// for local development where you legitimately want to POST to localhost.
// =============================================================================

export type UrlSafetyResult =
  | { ok: true; url: URL }
  | { ok: false; reason: string }

const BLOCKED_HOSTNAMES = new Set([
  'localhost',
  'localhost.localdomain',
  'ip6-localhost',
  'ip6-loopback',
  'broadcasthost',
])

function isBlockedIPv4(address: string): boolean {
  const parts = address.split('.').map(Number)
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) {
    return true // malformed — refuse rather than allow
  }
  const [a, b] = parts

  // 0.0.0.0/8 — "this network", routable in practice on some stacks
  if (a === 0) return true
  // 10.0.0.0/8 — private
  if (a === 10) return true
  // 100.64.0.0/10 — shared address space (carrier-grade NAT)
  if (a === 100 && b >= 64 && b <= 127) return true
  // 127.0.0.0/8 — loopback
  if (a === 127) return true
  // 169.254.0.0/16 — link-local (includes AWS IMDS at 169.254.169.254)
  if (a === 169 && b === 254) return true
  // 172.16.0.0/12 — private
  if (a === 172 && b >= 16 && b <= 31) return true
  // 192.168.0.0/16 — private
  if (a === 192 && b === 168) return true
  // 224.0.0.0/4 — multicast
  if (a >= 224 && a <= 239) return true
  // 240.0.0.0/4 — reserved
  if (a >= 240) return true

  return false
}

function isBlockedIPv6(address: string): boolean {
  // Normalise: strip zone id, lowercase
  const host = address.replace(/%.*$/, '').toLowerCase()

  // Loopback / unspecified
  if (host === '::' || host === '::1') return true

  // IPv4-mapped dotted form (::ffff:a.b.c.d) — pull out the embedded IPv4
  const mappedDotted = host.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/)
  if (mappedDotted) return isBlockedIPv4(mappedDotted[1])

  // IPv4-mapped hex form (::ffff:hhhh:hhhh) — Node canonicalises
  // `::ffff:127.0.0.1` to `::ffff:7f00:1`, so we have to recognise this too.
  const mappedHex = host.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/)
  if (mappedHex) {
    const high = parseInt(mappedHex[1], 16)
    const low = parseInt(mappedHex[2], 16)
    if (Number.isFinite(high) && Number.isFinite(low)) {
      const ipv4 = `${(high >> 8) & 0xff}.${high & 0xff}.${(low >> 8) & 0xff}.${low & 0xff}`
      return isBlockedIPv4(ipv4)
    }
  }

  // fc00::/7 — unique local address
  if (host.startsWith('fc') || host.startsWith('fd')) return true
  // fe80::/10 — link-local
  if (host.startsWith('fe8') || host.startsWith('fe9') || host.startsWith('fea') || host.startsWith('feb')) return true
  // ff00::/8 — multicast
  if (host.startsWith('ff')) return true

  return false
}

export function isSafeExternalUrl(raw: string): UrlSafetyResult {
  if (process.env.AGENTBOARD_ALLOW_LOCAL_WEBHOOK === '1') {
    try {
      return { ok: true, url: new URL(raw) }
    } catch {
      return { ok: false, reason: 'Invalid URL' }
    }
  }

  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return { ok: false, reason: 'Invalid URL' }
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return { ok: false, reason: `Unsupported protocol: ${url.protocol}` }
  }

  // Node's URL.hostname returns bracketed form for IPv6 literals (e.g. "[::1]").
  // Strip the brackets so isIP() and our prefix checks see the raw address.
  const rawHostname = url.hostname.toLowerCase()
  const hostname =
    rawHostname.startsWith('[') && rawHostname.endsWith(']')
      ? rawHostname.slice(1, -1)
      : rawHostname

  if (BLOCKED_HOSTNAMES.has(hostname)) {
    return { ok: false, reason: `Blocked hostname: ${hostname}` }
  }

  const family = isIP(hostname)
  if (family === 4 && isBlockedIPv4(hostname)) {
    return { ok: false, reason: `Blocked private/loopback/link-local IPv4: ${hostname}` }
  }
  if (family === 6 && isBlockedIPv6(hostname)) {
    return { ok: false, reason: `Blocked private/loopback/link-local IPv6: ${hostname}` }
  }

  return { ok: true, url }
}
