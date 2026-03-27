import type { RuntimeAdapter, DispatchParams, DispatchResult, McpArtifact } from './types'
import { executeMcpTool } from '@/lib/server/mcp-resolver'
import { traceToolCall } from '@/lib/server/tool-trace'

const MAX_TOOL_ROUNDS = 10

export const openaiAdapter: RuntimeAdapter = {
  id: 'openai',
  name: 'OpenAI',
  available: true,

  async dispatch(params: DispatchParams): Promise<DispatchResult> {
    const apiKey = params.runtimeConfig.apiKeyEnvVar
      ? process.env[params.runtimeConfig.apiKeyEnvVar as string]
      : process.env.OPENAI_API_KEY

    if (!apiKey) {
      throw new Error('OpenAI API key not configured')
    }

    const maxRounds = params.maxToolRounds ?? MAX_TOOL_ROUNDS
    const hasTools = params.tools && params.tools.length > 0 && params.mcpConnectionIds && params.mcpConnectionIds.length > 0
    let totalTokens = 0
    const collectedArtifacts: McpArtifact[] = []

    const messages: Array<Record<string, unknown>> = [
      { role: 'system', content: params.systemPrompt },
      {
        role: 'user',
        content: [
          params.previousOutput ? `Previous step output:\n${params.previousOutput}\n\n---\n\n` : '',
          params.taskContext,
        ].filter(Boolean).join(''),
      },
    ]

    const toolsDef = hasTools
      ? params.tools!.map(t => ({
          type: 'function' as const,
          function: {
            name: t.name,
            description: t.description,
            parameters: t.input_schema,
          },
        }))
      : undefined

    for (let round = 0; round < maxRounds; round++) {
      const body: Record<string, unknown> = {
        model: params.model || 'gpt-4o',
        max_tokens: 4096,
        messages,
      }
      if (toolsDef) body.tools = toolsDef

      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify(body),
      })

      if (!response.ok) {
        const errorBody = await response.text()
        throw new Error(`OpenAI API error ${response.status}: ${errorBody}`)
      }

      const data = await response.json()
      totalTokens += data.usage?.total_tokens || 0
      const message = data.choices?.[0]?.message

      if (!message) {
        return { output: '', tokensUsed: totalTokens, artifacts: collectedArtifacts.length > 0 ? collectedArtifacts : undefined }
      }

      // If no tool calls, return the text
      if (!message.tool_calls || message.tool_calls.length === 0 || !hasTools) {
        return {
          output: message.content || '',
          tokensUsed: totalTokens,
          artifacts: collectedArtifacts.length > 0 ? collectedArtifacts : undefined,
        }
      }

      // Add assistant message with tool calls to conversation
      messages.push(message)

      // Execute each tool call via MCP
      for (const toolCall of message.tool_calls) {
        const args = typeof toolCall.function.arguments === 'string'
          ? JSON.parse(toolCall.function.arguments)
          : toolCall.function.arguments || {}

        console.log(`[Dispatch] Executing tool: ${toolCall.function.name}`, args)

        const toolStart = Date.now()
        const mcpResult = await executeMcpTool(
          toolCall.function.name,
          args,
          params.mcpConnectionIds!,
        )
        const toolDurationMs = Date.now() - toolStart

        if (mcpResult.artifacts.length > 0) {
          collectedArtifacts.push(...mcpResult.artifacts)
        }

        if (params.executionId) {
          traceToolCall(params.executionId, toolCall.function.name, args, mcpResult.text, toolDurationMs).catch(console.error)
        }

        messages.push({
          role: 'tool',
          tool_call_id: toolCall.id,
          content: mcpResult.text,
        })
      }
    }

    console.warn(`[Dispatch] Tool-use loop hit ${maxRounds} round limit`)
    return {
      output: `[Tool execution reached ${maxRounds} round limit.]`,
      tokensUsed: totalTokens,
      artifacts: collectedArtifacts.length > 0 ? collectedArtifacts : undefined,
    }
  },
}
