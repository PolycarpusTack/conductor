// SECURITY: The webhook adapter sends task data (system prompt, context,
// previous outputs) to an admin-configured URL. To prevent an admin from
// pointing a runtime at internal infrastructure (AWS IMDS at
// 169.254.169.254, localhost services, RFC1918 ranges) we run the endpoint
// through isSafeExternalUrl before dispatching. See url-safety.ts for the
// known gaps — most notably DNS rebinding, which this literal-URL check
// doesn't cover.
import type { RuntimeAdapter, DispatchParams, DispatchResult } from './types'
import { isSafeExternalUrl } from '@/lib/server/url-safety'

export const webhookAdapter: RuntimeAdapter = {
  id: 'webhook',
  name: 'Custom Webhook',
  available: true,

  async dispatch(params: DispatchParams): Promise<DispatchResult> {
    const endpoint = params.runtimeConfig.endpoint
    if (!endpoint || typeof endpoint !== 'string') {
      throw new Error('Webhook endpoint not configured')
    }

    const safety = isSafeExternalUrl(endpoint)
    if (!safety.ok) {
      throw new Error(`Webhook endpoint rejected: ${safety.reason}`)
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
