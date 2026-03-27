// SECURITY NOTE: The webhook adapter sends task data (system prompt, context,
// previous outputs) to an admin-configured URL. Only trusted administrators
// should be allowed to create runtime configurations. The endpoint URL is not
// validated against private network ranges — consider adding SSRF protection
// (e.g., blocking 169.254.x.x, 10.x.x.x, 127.x.x.x) in production.
import type { RuntimeAdapter, DispatchParams, DispatchResult } from './types'

export const webhookAdapter: RuntimeAdapter = {
  id: 'webhook',
  name: 'Custom Webhook',
  available: true,

  async dispatch(params: DispatchParams): Promise<DispatchResult> {
    const endpoint = params.runtimeConfig.endpoint
    if (!endpoint || typeof endpoint !== 'string') {
      throw new Error('Webhook endpoint not configured')
    }

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        systemPrompt: params.systemPrompt,
        taskContext: params.taskContext,
        previousOutput: params.previousOutput,
        mode: params.mode,
        model: params.model,
      }),
    })

    if (!response.ok) {
      throw new Error(`Webhook error ${response.status}: ${await response.text()}`)
    }

    const data = await response.json()
    return {
      output: typeof data.output === 'string' ? data.output : JSON.stringify(data),
      tokensUsed: data.tokensUsed,
      cost: data.cost,
    }
  },
}
