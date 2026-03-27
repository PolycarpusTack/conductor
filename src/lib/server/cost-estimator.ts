/**
 * Token cost estimation helper for model families.
 * Costs are blended per-token rates (input + output combined).
 */

export const MODEL_COSTS: Record<string, number> = {
  'claude-opus': 0.00003,       // $30/M tokens blended
  'claude-sonnet': 0.000006,    // $6/M tokens blended
  'claude-haiku': 0.000002,     // $2/M tokens blended
  'gpt-4o-mini': 0.0000003,     // $0.30/M tokens blended
  'gpt-4o': 0.000005,           // $5/M tokens blended
  'gemini-2.5-pro': 0.000003,   // $3/M tokens blended
  'gemini-2.0-flash': 0.0000003, // $0.30/M tokens blended
  'glm-4': 0.000001,            // $1/M tokens blended
}

/**
 * Estimates the cost of a model invocation based on tokens used.
 *
 * @param model - The model identifier string (e.g. "claude-sonnet-4-5")
 * @param tokensUsed - The number of tokens consumed
 * @returns The estimated cost in USD, or 0 if no matching model is found
 */
export function estimateCost(model: string, tokensUsed: number): number {
  const modelLower = model.toLowerCase()

  for (const [key, costPerToken] of Object.entries(MODEL_COSTS)) {
    if (modelLower.includes(key)) {
      return tokensUsed * costPerToken
    }
  }

  return 0
}
