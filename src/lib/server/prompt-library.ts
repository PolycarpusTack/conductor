import fs from 'fs'
import path from 'path'
import type { PromptLibraryEntry, PromptLibraryEntryFull, PromptLibraryListResponse } from '../../types/prompt-library'
import { MAX_PROMPT_CONTENT_CHARS } from '@/types/prompt-library'

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

/** Reads all .md files in a directory and returns them as PromptLibraryEntry records. */
function readCategoryEntries(categoryName: string, categoryDir: string): PromptLibraryEntry[] {
  const files = fs.readdirSync(categoryDir, { withFileTypes: true })
  const entries: PromptLibraryEntry[] = []

  for (const file of files) {
    if (file.name.startsWith('.')) continue
    if (!file.isFile() || !file.name.endsWith('.md')) continue

    const relativePath = categoryName ? `${categoryName}/${file.name}` : file.name
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
  return entries
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

interface CacheEntry {
  data: PromptLibraryListResponse
  expiresAt: number
}

let listCache: CacheEntry | null = null

const CACHE_TTL_MS = 60_000

/** Clears the list cache — intended for use in tests only. */
export function clearListCache(): void {
  listCache = null
}

/**
 * Lists all prompt archive entries grouped by top-level category folder.
 * Skips hidden directories (names starting with '.') and non-.md files.
 * Returns entries sorted alphabetically by title within each category.
 * Categories are sorted alphabetically.
 */
export function listEntries(): PromptLibraryListResponse {
  if (listCache && Date.now() < listCache.expiresAt) {
    return listCache.data
  }
  const error = validateLibraryPath()
  if (error) throw new Error(error)
  const libraryPath = getLibraryPath()!

  const topLevel = fs.readdirSync(libraryPath, { withFileTypes: true })
  const categoryMap = new Map<string, PromptLibraryEntry[]>()

  for (const entry of topLevel) {
    if (entry.name.startsWith('.')) continue
    if (entry.isDirectory()) {
      const categoryDir = path.join(libraryPath, entry.name)
      const entries = readCategoryEntries(entry.name, categoryDir)
      if (entries.length > 0) categoryMap.set(entry.name, entries)
    }
  }

  // Root-level .md files — placed in category ""
  const rootEntries = readCategoryEntries('', libraryPath)
  if (rootEntries.length > 0) categoryMap.set('', rootEntries)

  // Sort categories alphabetically, root "" goes last
  const sortedNames = Array.from(categoryMap.keys())
    .filter(name => name !== '')
    .sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()))
  if (categoryMap.has('')) sortedNames.push('')

  const categories = sortedNames.map(name => ({
    name,
    entries: categoryMap.get(name)!,
  }))

  const result: PromptLibraryListResponse = { categories }
  listCache = { data: result, expiresAt: Date.now() + CACHE_TTL_MS }
  return result
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
