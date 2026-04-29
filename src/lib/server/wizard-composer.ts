import { listEntries, getEntry } from './prompt-library'
import type { PromptLibraryEntry, PromptLibraryEntryFull } from '@/types/prompt-library'

/** Scores an archive entry against a set of search terms (case-insensitive). Title matches score highest. */
export function scoreEntry(entry: PromptLibraryEntry, terms: string[]): number {
  const haystack = [entry.title, entry.category, entry.description]
    .join(' ')
    .toLowerCase()

  return terms.reduce((score, term) => {
    const t = term.toLowerCase()
    if (entry.title.toLowerCase().includes(t)) return score + 3
    if (entry.category.toLowerCase().includes(t)) return score + 2
    if (haystack.includes(t)) return score + 1
    return score
  }, 0)
}

/** Returns the top N archive entries most relevant to the given terms. Falls back to largest entries if nothing matches. */
export async function findRelevantEntries(terms: string[], topN = 3): Promise<PromptLibraryEntryFull[]> {
  const library = listEntries()
  const allEntries = library.categories.flatMap((c) => c.entries)

  const scored = allEntries
    .map((e) => ({ entry: e, score: scoreEntry(e, terms) }))
    .sort((a, b) => b.score - a.score || b.entry.charCount - a.entry.charCount)

  const top = scored.slice(0, topN).map((s) => s.entry)
  const full = top.map((e) => getEntry(e.id))
  return full.filter((e): e is PromptLibraryEntryFull => e !== null)
}
