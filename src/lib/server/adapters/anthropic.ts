import type { RuntimeAdapter, DispatchParams, DispatchResult } from './types'
import { executeMcpTool } from '@/lib/server/mcp-resolver'

const MAX_TOOL_ROUNDS = 10

export const anthropicAdapter: RuntimeAdapter = {
  id: 'anthropic',
  name: 'Anthropic',
  available: true,

  async dispatch(params: DispatchParams): Promise<DispatchResult> {
    const apiKey = params.runtimeConfig.apiKeyEnvVar
      ? process.env[params.runtimeConfig.apiKeyEnvVar]
      : process.env.ANTHROPIC_API_KEY

    if (!apiKey) {
      throw new Error('Anthropic API key not configured')
    }

    const hasTools =
      params.tools && params.tools.length > 0 &&
      params.mcpConnectionIds && params.mcpConnectionIds.length > 0

    const maxRounds = params.maxToolRounds ?? MAX_TOOL_ROUNDS

    let totalTokens = 0

    const messages: Array<{ role: string; content: unknown }> = [
      {
        role: 'user',
        content: [
          params.previousOutput ? `Previous step output:\n${params.previousOutput}\n\n---\n\n` : '',
          params.taskContext,
        ].filter(Boolean).join(''),
      },
    ]

    const baseBody: Record<string, unknown> = {
      model: params.model || 'claude-sonnet-4-20250514',
      max_tokens: 4096,
      system: params.systemPrompt,
      ...(hasTools && {
        tools: params.tools!.map(t => ({
          name: t.name,
          description: t.description,
          input_schema: t.input_schema,
        })),
      }),
    }

    for (let round = 0; round < maxRounds; round++) {
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          ...baseBody,
          messages,
        }),
      })

      if (!response.ok) {
        const errorBody = await response.text()
        throw new Error(`Anthropic API error ${response.status}: ${errorBody}`)
      }

      const data = await response.json()
      totalTokens += (data.usage?.input_tokens || 0) + (data.usage?.output_tokens || 0)

      const toolUseBlocks: Array<{ type: string; id: string; name: string; input: Record<string, unknown> }> =
        data.content?.filter((b: { type: string }) => b.type === 'tool_use') ?? []

      if (toolUseBlocks.length === 0) {
        const textBlock = data.content?.find((b: { type: string }) => b.type === 'text')
        return {
          output: textBlock?.text || '',
          tokensUsed: totalTokens,
        }
      }

      // Append the assistant message with all content blocks
      messages.push({ role: 'assistant', content: data.content })

      // Execute each tool call via MCP
      const toolResults: Array<{ type: string; tool_use_id: string; content: string }> = []
      for (const toolBlock of toolUseBlocks) {
        console.log(`[Dispatch] Executing tool: ${toolBlock.name}`, toolBlock.input)
        let result: string
        try {
          result = await executeMcpTool(
            toolBlock.name,
            toolBlock.input,
            params.mcpConnectionIds!,
          )
        } catch (err) {
          result = `Error executing tool ${toolBlock.name}: ${err instanceof Error ? err.message : String(err)}`
        }
        toolResults.push({
          type: 'tool_result',
          tool_use_id: toolBlock.id,
          content: result,
        })
      }

      // Append tool results as a user message
      messages.push({ role: 'user', content: toolResults })
    }

    // Safety: hit the round limit
    console.warn(`[Dispatch] Tool-use loop hit ${maxRounds} round limit`)
    return {
      output: `[Tool execution reached ${maxRounds} round limit. The agent may not have completed its work.]`,
      tokensUsed: totalTokens,
    }
  },
}
