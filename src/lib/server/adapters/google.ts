import type { RuntimeAdapter, DispatchParams, DispatchResult } from './types'
import { executeMcpTool } from '@/lib/server/mcp-resolver'

const MAX_TOOL_ROUNDS = 10

export const googleAdapter: RuntimeAdapter = {
  id: 'google',
  name: 'Google Gemini',
  available: true,

  async dispatch(params: DispatchParams): Promise<DispatchResult> {
    const apiKey = params.runtimeConfig.apiKeyEnvVar
      ? process.env[params.runtimeConfig.apiKeyEnvVar as string]
      : process.env.GOOGLE_AI_API_KEY

    if (!apiKey) {
      throw new Error('Google AI API key not configured')
    }

    const model = params.model || 'gemini-2.0-flash'
    const hasTools = !!(params.tools?.length && params.mcpConnectionIds?.length)
    const maxRounds = params.maxToolRounds ?? MAX_TOOL_ROUNDS

    const contents: Array<{ role: string; parts: unknown[] }> = [
      {
        role: 'user',
        parts: [
          {
            text: [
              params.previousOutput ? `Previous step output:\n${params.previousOutput}\n\n---\n\n` : '',
              params.taskContext,
            ].filter(Boolean).join(''),
          },
        ],
      },
    ]

    const toolsConfig = hasTools
      ? [
          {
            functionDeclarations: params.tools!.map((tool) => ({
              name: tool.name,
              description: tool.description,
              parameters: tool.input_schema,
            })),
          },
        ]
      : undefined

    let totalTokens = 0

    for (let round = 0; round < maxRounds; round++) {
      const requestBody: Record<string, unknown> = {
        systemInstruction: {
          parts: [{ text: params.systemPrompt }],
        },
        contents,
        generationConfig: {
          maxOutputTokens: 4096,
        },
      }

      if (toolsConfig) {
        requestBody.tools = toolsConfig
      }

      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1/models/${model}:generateContent?key=${apiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(requestBody),
        },
      )

      if (!response.ok) {
        const errorBody = await response.text()
        throw new Error(`Google AI API error ${response.status}: ${errorBody}`)
      }

      const data = await response.json()

      if (data.usageMetadata?.totalTokenCount) {
        totalTokens += data.usageMetadata.totalTokenCount
      }

      const parts: Array<Record<string, unknown>> = data.candidates?.[0]?.content?.parts ?? []
      const functionCallParts = parts.filter((p) => p.functionCall)

      if (functionCallParts.length === 0) {
        const text = parts
          .filter((p) => typeof p.text === 'string')
          .map((p) => p.text as string)
          .join('')

        return {
          output: text,
          tokensUsed: totalTokens || undefined,
        }
      }

      // Push model's response (with function calls) into the conversation
      contents.push({
        role: 'model',
        parts,
      })

      // Execute each tool call and collect function responses
      const functionResponseParts: unknown[] = []

      for (const part of functionCallParts) {
        const { name, args } = part.functionCall as { name: string; args: Record<string, unknown> }
        console.log(`[Dispatch] Executing tool: ${name}`, args)
        const result = await executeMcpTool(name, args, params.mcpConnectionIds!)
        functionResponseParts.push({
          functionResponse: {
            name,
            response: { content: result },
          },
        })
      }

      // Push tool results back into the conversation
      contents.push({
        role: 'user',
        parts: functionResponseParts,
      })
    }

    // Safety exit: return whatever the last text response was, if any
    const lastModelEntry = [...contents].reverse().find((c) => c.role === 'model')
    const lastParts = (lastModelEntry?.parts ?? []) as Array<Record<string, unknown>>
    const fallbackText = lastParts
      .filter((p) => typeof p.text === 'string')
      .map((p) => p.text as string)
      .join('')

    return {
      output: fallbackText || '[Max tool rounds reached without a final text response]',
      tokensUsed: totalTokens || undefined,
    }
  },
}
