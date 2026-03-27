# MCP Tool Execution Loop — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enable agents to autonomously execute MCP tools during dispatch. When a model responds with a tool call, Conductor executes it against the MCP server and feeds the result back — looping until the model produces a final text response.

**Architecture:** The tool-use loop lives inside each runtime adapter. The dispatch engine passes `mcpConnectionIds` so adapters can call `executeMcpTool`. A safety limit prevents infinite loops.

**Tech Stack:** Same as Conductor (Next.js 16, Prisma 7, TypeScript)

**Current state:** Tools are discovered from MCP servers and passed to AI providers. Models can see the tools but tool_use responses are ignored — only the text output is captured. `executeMcpTool()` in `mcp-resolver.ts` is fully implemented but never called.

---

## Task 1: Extend DispatchParams with MCP context

**Files:**
- Modify: `src/lib/server/adapters/types.ts`

- [ ] **Step 1: Add mcpConnectionIds and maxToolRounds to DispatchParams**

```typescript
export interface DispatchParams {
  systemPrompt: string
  taskContext: string
  previousOutput?: string
  mode: string
  model: string
  runtimeConfig: {
    apiKeyEnvVar?: string
    endpoint?: string
    [key: string]: unknown
  }
  tools?: McpTool[]
  mcpConnectionIds?: string[]  // Needed by adapters to execute tool calls
  maxToolRounds?: number       // Safety limit, default 10
}
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/server/adapters/types.ts
git commit -m "feat: add mcpConnectionIds to DispatchParams for tool execution"
```

---

## Task 2: Pass mcpConnectionIds from dispatch engine to adapters

**Files:**
- Modify: `src/lib/server/dispatch.ts`

- [ ] **Step 1: Pass mcpConnectionIds in the adapter.dispatch() call**

Find the `adapter.dispatch({...})` call (around line 100). Add `mcpConnectionIds`:

```typescript
    const result = await adapter.dispatch({
      systemPrompt,
      taskContext: fullTaskContext,
      previousOutput: previousStep?.output || undefined,
      mode: step.mode,
      model: agent.runtimeModel || 'default',
      runtimeConfig,
      tools: tools.length > 0 ? tools : undefined,
      mcpConnectionIds: mcpConnectionIds.length > 0 ? mcpConnectionIds : undefined,
    })
```

The `mcpConnectionIds` variable already exists in scope (line 81-83).

- [ ] **Step 2: Commit**

```bash
git add src/lib/server/dispatch.ts
git commit -m "feat: pass mcpConnectionIds to runtime adapters"
```

---

## Task 3: Implement tool-use loop in Anthropic adapter

**Files:**
- Modify: `src/lib/server/adapters/anthropic.ts`

This is the core change. The adapter needs to:
1. Send the initial request with tools
2. Check if the response contains `tool_use` blocks
3. If yes: execute each tool via `executeMcpTool`, build tool result messages, send back to model
4. Repeat until the model responds with only text (no tool_use) or the round limit is hit
5. Return the final text output

- [ ] **Step 1: Rewrite the Anthropic adapter with a conversation loop**

```typescript
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

    const maxRounds = params.maxToolRounds || MAX_TOOL_ROUNDS
    const hasTools = params.tools && params.tools.length > 0 && params.mcpConnectionIds && params.mcpConnectionIds.length > 0
    let totalTokens = 0

    // Build initial messages
    const messages: Array<{ role: string; content: unknown }> = [{
      role: 'user',
      content: [
        params.previousOutput ? `Previous step output:\n${params.previousOutput}\n\n---\n\n` : '',
        params.taskContext,
      ].filter(Boolean).join(''),
    }]

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

    // Conversation loop
    for (let round = 0; round < maxRounds; round++) {
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({ ...baseBody, messages }),
      })

      if (!response.ok) {
        const errorBody = await response.text()
        throw new Error(`Anthropic API error ${response.status}: ${errorBody}`)
      }

      const data = await response.json()
      totalTokens += (data.usage?.input_tokens || 0) + (data.usage?.output_tokens || 0)

      // Check if the model wants to use tools
      const toolUseBlocks = (data.content || []).filter(
        (b: { type: string }) => b.type === 'tool_use'
      )

      // If no tool calls or no MCP context, extract text and return
      if (toolUseBlocks.length === 0 || !hasTools) {
        const textParts = (data.content || [])
          .filter((b: { type: string }) => b.type === 'text')
          .map((b: { text: string }) => b.text)

        return {
          output: textParts.join('\n') || '',
          tokensUsed: totalTokens,
        }
      }

      // Execute each tool call via MCP
      const toolResults: Array<{
        type: 'tool_result'
        tool_use_id: string
        content: string
      }> = []

      for (const toolUse of toolUseBlocks) {
        console.log(`[Dispatch] Executing tool: ${toolUse.name}`, toolUse.input)

        const result = await executeMcpTool(
          toolUse.name,
          toolUse.input || {},
          params.mcpConnectionIds!,
        )

        toolResults.push({
          type: 'tool_result',
          tool_use_id: toolUse.id,
          content: result,
        })
      }

      // Add the assistant's response (with tool_use blocks) and our tool results to the conversation
      messages.push({ role: 'assistant', content: data.content })
      messages.push({ role: 'user', content: toolResults })
    }

    // Safety: hit the round limit — return whatever text we have so far
    console.warn(`[Dispatch] Tool-use loop hit ${maxRounds} round limit`)
    return {
      output: `[Tool execution reached ${maxRounds} round limit. The agent may not have completed its work.]`,
      tokensUsed: totalTokens,
    }
  },
}
```

Key points:
- The loop only activates when BOTH `tools` AND `mcpConnectionIds` are present
- Without MCP connections, it works exactly as before (single request, text response)
- Each tool call is logged for debugging
- The conversation maintains full history (assistant response with tool_use → user response with tool_result)
- A safety limit (10 rounds default) prevents infinite loops
- If the limit is hit, a warning message is returned as output

- [ ] **Step 2: Commit**

```bash
git add src/lib/server/adapters/anthropic.ts
git commit -m "feat: implement tool-use execution loop in Anthropic adapter"
```

---

## Task 4: Implement tool-use loop in OpenAI adapter

**Files:**
- Modify: `src/lib/server/adapters/openai.ts`

Same pattern but with OpenAI's function calling format. The key differences:
- Tool calls come in `message.tool_calls` array (not `content` blocks)
- Each tool call has `id`, `function.name`, `function.arguments` (JSON string)
- Tool results are sent as `role: 'tool'` messages with `tool_call_id`

- [ ] **Step 1: Rewrite the OpenAI adapter with a conversation loop**

```typescript
import type { RuntimeAdapter, DispatchParams, DispatchResult } from './types'
import { executeMcpTool } from '@/lib/server/mcp-resolver'

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

    const maxRounds = params.maxToolRounds || MAX_TOOL_ROUNDS
    const hasTools = params.tools && params.tools.length > 0 && params.mcpConnectionIds && params.mcpConnectionIds.length > 0
    let totalTokens = 0

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
        return { output: '', tokensUsed: totalTokens }
      }

      // If no tool calls, return the text
      if (!message.tool_calls || message.tool_calls.length === 0 || !hasTools) {
        return {
          output: message.content || '',
          tokensUsed: totalTokens,
        }
      }

      // Add assistant message with tool calls to conversation
      messages.push(message)

      // Execute each tool call
      for (const toolCall of message.tool_calls) {
        const args = typeof toolCall.function.arguments === 'string'
          ? JSON.parse(toolCall.function.arguments)
          : toolCall.function.arguments || {}

        console.log(`[Dispatch] Executing tool: ${toolCall.function.name}`, args)

        const result = await executeMcpTool(
          toolCall.function.name,
          args,
          params.mcpConnectionIds!,
        )

        messages.push({
          role: 'tool',
          tool_call_id: toolCall.id,
          content: result,
        })
      }
    }

    console.warn(`[Dispatch] Tool-use loop hit ${maxRounds} round limit`)
    return {
      output: `[Tool execution reached ${maxRounds} round limit.]`,
      tokensUsed: totalTokens,
    }
  },
}
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/server/adapters/openai.ts
git commit -m "feat: implement tool-use execution loop in OpenAI adapter"
```

---

## Task 5: Implement tool-use loop in Z.ai adapter

**Files:**
- Modify: `src/lib/server/adapters/zai.ts`

Z.ai uses OpenAI-compatible format, so this is nearly identical to the OpenAI adapter but with:
- Base URL: `https://api.z.ai/api/paas/v4/chat/completions`
- Default model: `glm-4.6`
- Env var fallback: `ZAI_API_KEY`

- [ ] **Step 1: Rewrite the Z.ai adapter with a conversation loop**

Same structure as the OpenAI adapter in Task 4, with Z.ai-specific URL, model, and env var. Copy the OpenAI pattern and change:
- fetch URL to `https://api.z.ai/api/paas/v4/chat/completions`
- default model to `glm-4.6`
- env var to `ZAI_API_KEY`
- error prefix to `Z.ai API error`

- [ ] **Step 2: Commit**

```bash
git add src/lib/server/adapters/zai.ts
git commit -m "feat: implement tool-use execution loop in Z.ai adapter"
```

---

## Task 6: Update MCP resolver comment and add logging

**Files:**
- Modify: `src/lib/server/mcp-resolver.ts`

- [ ] **Step 1: Update the top comment**

Replace the existing NOTE comment with:
```typescript
// MCP Tool Integration
// Tools are discovered from MCP servers via tools/list and passed to AI providers.
// When a model responds with tool_use, the adapter calls executeMcpTool() which
// executes the tool against the MCP server via tools/call and returns the result.
// The adapter loops until the model produces a final text response.
```

- [ ] **Step 2: Add logging to executeMcpTool**

At the start of `executeMcpTool`, add:
```typescript
  console.log(`[MCP] Executing tool: ${toolName}`)
```

At the end of the successful path (before return), add:
```typescript
  console.log(`[MCP] Tool ${toolName} returned ${textParts.length} text parts`)
```

- [ ] **Step 3: Commit**

```bash
git add src/lib/server/mcp-resolver.ts
git commit -m "docs: update MCP resolver comment, add execution logging"
```

---

## Task 7: Integration test checklist

Manual verification to confirm the full loop works.

- [ ] **Step 1: Verify adapter handles no-tools case unchanged**

Create a task with a non-MCP agent. Confirm dispatch works as before — single API call, text response, no tool loop.

- [ ] **Step 2: Verify tool discovery still works**

Configure an MCP connection with an endpoint. Verify `resolveMcpTools` returns tools.

- [ ] **Step 3: Verify tool-use loop executes**

Configure an agent with an MCP connection and a runtime. Create a task that would trigger tool use (e.g., "search the codebase for X"). Verify:
- Model receives tools in the API call
- Model responds with tool_use
- `executeMcpTool` is called (check logs)
- Tool result is sent back to the model
- Model produces final text output
- Step output contains the complete analysis

- [ ] **Step 4: Verify safety limit**

Temporarily set `maxToolRounds` to 2. Trigger a task that would use many tools. Verify the loop stops and returns the warning message.

---

## Summary

| Task | File(s) | What changes |
|------|---------|-------------|
| 1 | `adapters/types.ts` | Add `mcpConnectionIds` + `maxToolRounds` to DispatchParams |
| 2 | `dispatch.ts` | Pass `mcpConnectionIds` to adapter |
| 3 | `adapters/anthropic.ts` | Full tool-use conversation loop |
| 4 | `adapters/openai.ts` | Full tool-use conversation loop (OpenAI format) |
| 5 | `adapters/zai.ts` | Full tool-use conversation loop (Z.ai/OpenAI format) |
| 6 | `mcp-resolver.ts` | Update comment + add logging |
| 7 | — | Manual integration test |

**After this, the full flow is:**
MCP server → `tools/list` → tools passed to model → model calls `tool_use` → `executeMcpTool` → `tools/call` to MCP → result back to model → repeat until final text → saved as step output
