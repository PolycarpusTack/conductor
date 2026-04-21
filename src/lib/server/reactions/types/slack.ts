export async function executeSlackReaction(config: Record<string, unknown>): Promise<{ ok: true }> {
  const webhookUrl = process.env[config.webhookEnvVar as string]
  if (!webhookUrl) throw new Error(`Env var "${config.webhookEnvVar}" is not set`)

  const body: Record<string, unknown> = { text: config.text as string }
  if (config.blocks) body.blocks = config.blocks

  const res = await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })

  if (!res.ok) throw new Error(`Slack webhook failed: ${res.status} ${res.statusText}`)
  return { ok: true }
}
