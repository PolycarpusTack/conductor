import fs from 'fs'
import path from 'path'
import type { PromptLibraryEntry, PromptLibraryEntryFull, PromptLibraryListResponse } from '../../types/prompt-library'

/** Maximum characters of prompt content returned by the single-entry endpoint. Leaves headroom for Mustache variable injection at dispatch time. */
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

function encodeId(relativePath: string): string {
  return Buffer.from(relativePath).toString('base64url')
}

function decodeId(id: string): string {
  return Buffer.from(id, 'base64url').toString('utf8')
}

function extractTitle(content: string, fallback: string): string {
  const match = content.match(/^#\s+(.+)$/m)
  return match ? match[1].trim() : fallback
}

function extractDescription(content: string): string {
  const lines = content.split('\n')
  const paragraphLines: string[] = []

  for (const line of lines) {
    const trimmed = line.trim()
    if (trimmed.startsWith('#')) {
      if (paragraphLines.length > 0) break
      continue
    }
    if (trimmed === '') {
      if (paragraphLines.length > 0) break
      continue
    }
    paragraphLines.push(trimmed)
  }

  return paragraphLines.join(' ').slice(0, 200)
}

/**
 * Lists all prompt archive entries grouped by top-level category folder.
 * Skips hidden directories (names starting with '.') and non-.md files.
 * Returns entries sorted alphabetically by title within each category.
 * Categories are sorted alphabetically.
 */
export function listEntries(): PromptLibraryListResponse {
  const error = validateLibraryPath()
  if (error) throw new Error(error)
  const libraryPath = getLibraryPath()!

  const topLevel = fs.readdirSync(libraryPath, { withFileTypes: true })

  const categoryMap = new Map<string, PromptLibraryEntry[]>()

  // Process subdirectories (categories)
  for (const entry of topLevel) {
    if (entry.name.startsWith('.')) continue

    if (entry.isDirectory()) {
      const categoryName = entry.name
      const categoryDir = path.join(libraryPath, categoryName)
      const files = fs.readdirSync(categoryDir, { withFileTypes: true })
      const entries: PromptLibraryEntry[] = []

      for (const file of files) {
        if (file.name.startsWith('.')) continue
        if (!file.isFile() || !file.name.endsWith('.md')) continue

        const relativePath = `${categoryName}/${file.name}`
        const absolutePath = path.join(categoryDir, file.name)
        const content = fs.readFileSync(absolutePath, 'utf8')
        const fallback = file.name.replace(/\.md$/, '')

        entries.push({
          id: encodeId(relativePath),
          category: categoryName,
          title: extractTitle(content, fallback),
          description: extractDescription(content),
          charCount: content.length,
          relativePath,
        })
      }

      entries.sort((a, b) => a.title.toLowerCase().localeCompare(b.title.toLowerCase()))
      categoryMap.set(categoryName, entries)
    }
  }

  // Process root-level .md files — placed in category ""
  const rootMdEntries: PromptLibraryEntry[] = []
  for (const entry of topLevel) {
    if (entry.name.startsWith('.')) continue
    if (!entry.isFile() || !entry.name.endsWith('.md')) continue

    const relativePath = entry.name
    const absolutePath = path.join(libraryPath, entry.name)
    const content = fs.readFileSync(absolutePath, 'utf8')
    const fallback = entry.name.replace(/\.md$/, '')

    rootMdEntries.push({
      id: encodeId(relativePath),
      category: '',
      title: extractTitle(content, fallback),
      description: extractDescription(content),
      charCount: content.length,
      relativePath,
    })
  }
  if (rootMdEntries.length > 0) {
    rootMdEntries.sort((a, b) => a.title.toLowerCase().localeCompare(b.title.toLowerCase()))
    categoryMap.set('', rootMdEntries)
  }

  // Sort categories alphabetically, root "" goes last
  const sortedNames = Array.from(categoryMap.keys())
    .filter(name => name !== '')
    .sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()))

  if (categoryMap.has('')) {
    sortedNames.push('')
  }

  const categories = sortedNames.map(name => ({
    name,
    entries: categoryMap.get(name)!,
  }))

  return { categories }
}

/**
 * Returns a single entry by its encoded ID, or null if not found.
 * Content is capped at MAX_PROMPT_CONTENT_CHARS characters.
 * If truncated, appends "\n\n---\n*[Content truncated to 9500 characters]*" to the content.
 */
export function getEntry(id: string): PromptLibraryEntryFull | null {
  const error = validateLibraryPath()
  if (error) throw new Error(error)
  const libraryPath = getLibraryPath()!

  const relativePath = decodeId(id)
  const absolutePath = path.join(libraryPath, relativePath)

  if (!absolutePath.startsWith(libraryPath + path.sep) && absolutePath !== libraryPath) {
    return null
  }

  if (!fs.existsSync(absolutePath)) return null

  const rawContent = fs.readFileSync(absolutePath, 'utf8')
  const charCount = rawContent.length
  const truncated = rawContent.length > MAX_PROMPT_CONTENT_CHARS

  let content: string
  if (truncated) {
    content = rawContent.slice(0, MAX_PROMPT_CONTENT_CHARS) + '\n\n---\n*[Content truncated to 9500 characters]*'
  } else {
    content = rawContent
  }

  const parts = relativePath.split('/')
  const category = parts.length > 1 ? parts[0] : ''
  const filename = parts[parts.length - 1]
  const fallback = filename.replace(/\.md$/, '')

  return {
    id,
    category,
    title: extractTitle(rawContent, fallback),
    description: extractDescription(rawContent),
    charCount,
    relativePath,
    content,
    truncated,
  }
}
