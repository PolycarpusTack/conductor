import fs from 'fs'
import type { PromptLibraryEntry, PromptLibraryEntryFull, PromptLibraryListResponse } from '@/types/prompt-library'

export const MAX_PROMPT_CONTENT_CHARS = 9_500

/** Returns the configured archive root, or null if not set. */
export function getLibraryPath(): string | null {
  return process.env.PROMPT_LIBRARY_PATH ?? null
}

/**
 * Returns an error string if the library path is unusable, or null if healthy.
 * Used by API routes to return 503 early.
 */
export function validateLibraryPath(): string | null {
  const p = getLibraryPath()
  if (!p) return 'Prompt library not configured'
  if (!fs.existsSync(p)) return `Prompt library path does not exist: ${p}`
  return null
}
