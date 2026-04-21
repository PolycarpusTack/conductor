export async function executeHttpReaction(
  config: Record<string, unknown>,
): Promise<{ status: number; ok: true }> {
  const url = config.url as string
  if (!url) throw new Error('post:http reaction requires a "url" field')

  const parsed = new URL(url)
  if (parsed.protocol !== 'https:') throw new Error('post:http only allows https:// URLs')

  const method = (config.method as string) || 'POST'
  const headers = (config.headers as Record<string, string>) || {}

  const hasBody = config.body !== undefined && method !== 'GET' && method !== 'HEAD'
  const res = await fetch(url, {
    method,
    headers: { ...(hasBody ? { 'Content-Type': 'application/json' } : {}), ...headers },
    body: hasBody ? JSON.stringify(config.body) : undefined,
  })

  if (!res.ok) throw new Error(`HTTP request to ${url} failed: ${res.status} ${res.statusText}`)
  return { status: res.status, ok: true }
}
