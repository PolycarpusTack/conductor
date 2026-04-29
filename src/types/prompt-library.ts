/** Lightweight metadata returned in list responses. */
export interface PromptLibraryEntry {
  /** base64url-encoded relative file path — stable, URL-safe ID */
  id: string
  /** Top-level folder name: "Anthropic", "OpenAI", "Google", "agents", etc. */
  category: string
  /** Derived from the first H1 heading, or the filename without extension */
  title: string
  /** First non-heading paragraph, or empty string */
  description: string
  /** Raw character count — used to warn the user before loading large files */
  charCount: number
  /** Relative path from the library root, for display */
  relativePath: string
}

/** Full entry including content, returned by the single-entry endpoint. */
export interface PromptLibraryEntryFull extends PromptLibraryEntry {
  /**
   * Raw markdown content, capped at MAX_PROMPT_CONTENT_CHARS.
   * If truncated, a notice is appended to the end.
   */
  content: string
  /** True when content was truncated to fit the cap */
  truncated: boolean
}

export interface PromptLibraryListResponse {
  categories: {
    name: string
    entries: PromptLibraryEntry[]
  }[]
}
