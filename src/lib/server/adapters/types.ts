export interface McpTool {
  name: string
  description: string
  input_schema: Record<string, unknown>
}

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
  mcpConnectionIds?: string[]
  maxToolRounds?: number
  executionId?: string  // For tool call tracing
}

export interface McpArtifact {
  type: string
  label: string
  content?: string
  url?: string
  mimeType?: string
}

export interface DispatchResult {
  output: string
  tokensUsed?: number
  cost?: number
  artifacts?: McpArtifact[]
}

export interface RuntimeAdapter {
  id: string
  name: string
  available: boolean
  dispatch(params: DispatchParams): Promise<DispatchResult>
}
