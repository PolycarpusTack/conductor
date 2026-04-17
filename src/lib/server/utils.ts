/**
 * Safely parse a JSON-encoded string. Returns `fallback` on null/undefined
 * input or parse failure. Generic — caller asserts the expected shape via T.
 */
export function safeJsonParse<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback
  try {
    return JSON.parse(value) as T
  } catch {
    return fallback
  }
}
