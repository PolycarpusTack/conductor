'use client'

import { useState, useEffect, useRef } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent } from 'react'
import ReactMarkdown from 'react-markdown'
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Input } from '@/components/ui/input'
import { Loader2, FileText, AlertCircle } from 'lucide-react'
import { MAX_PROMPT_CONTENT_CHARS } from '@/types/prompt-library'
import type { PromptLibraryEntry, PromptLibraryListResponse, PromptLibraryEntryFull } from '@/types/prompt-library'

interface PromptArchivePickerProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Called when the user clicks "Use as Base" */
  onSelect: (content: string, meta: PromptLibraryEntry) => void
}

type FetchState<T> = { status: 'idle' } | { status: 'loading' } | { status: 'ok'; data: T } | { status: 'error'; message: string }

/** Browsable slide-over panel for selecting a system prompt from the local archive. */
export function PromptArchivePicker({ open, onOpenChange, onSelect }: PromptArchivePickerProps) {
  const [library, setLibrary] = useState<FetchState<PromptLibraryListResponse>>({ status: 'idle' })
  const [selected, setSelected] = useState<PromptLibraryEntry | null>(null)
  const [preview, setPreview] = useState<FetchState<PromptLibraryEntryFull>>({ status: 'idle' })
  const [filter, setFilter] = useState('')
  // TD-005: roving-tabindex focus target for the entry list (the option whose
  // tabIndex is 0). Arrow/Home/End move it; only one entry is in the tab order.
  const [activeId, setActiveId] = useState<string | null>(null)
  const entryRefs = useRef(new Map<string, HTMLButtonElement>())

  const filteredCategories = library.status === 'ok'
    ? library.data.categories
        .map((cat) => ({
          ...cat,
          entries: filter.trim()
            ? cat.entries.filter((e) =>
                e.title.toLowerCase().includes(filter.toLowerCase()) ||
                e.description.toLowerCase().includes(filter.toLowerCase())
              )
            : cat.entries,
        }))
        .filter((cat) => cat.entries.length > 0)
    : []

  // TD-005: flat DOM-order list of visible entries for roving-tabindex math.
  const flatEntries = filteredCategories.flatMap((cat) => cat.entries)
  // The single entry that is keyboard-focusable (tabIndex 0). Falls back to the
  // first entry when nothing has been focused yet or the active one filtered out.
  const rovingId = activeId && flatEntries.some((e) => e.id === activeId)
    ? activeId
    : flatEntries[0]?.id

  function focusEntryAt(index: number) {
    if (flatEntries.length === 0) return
    const clamped = Math.min(Math.max(index, 0), flatEntries.length - 1)
    const target = flatEntries[clamped]
    setActiveId(target.id)
    entryRefs.current.get(target.id)?.focus()
  }

  function handleListKeyDown(e: ReactKeyboardEvent<HTMLDivElement>) {
    if (flatEntries.length === 0) return
    const current = flatEntries.findIndex((entry) => entry.id === rovingId)
    const idx = current < 0 ? 0 : current
    switch (e.key) {
      case 'ArrowDown': e.preventDefault(); focusEntryAt(idx + 1); break
      case 'ArrowUp': e.preventDefault(); focusEntryAt(idx - 1); break
      case 'Home': e.preventDefault(); focusEntryAt(0); break
      case 'End': e.preventDefault(); focusEntryAt(flatEntries.length - 1); break
    }
  }

  useEffect(() => {
    if (!open) return
    fetch('/api/prompt-library')
      .then((r) => r.json())
      .then((data) => {
        if (data.error) setLibrary({ status: 'error', message: data.error })
        else setLibrary({ status: 'ok', data })
      })
      .catch(() => setLibrary({ status: 'error', message: 'Failed to load prompt library' }))
  }, [open])

  // Reset to the idle (loading) state on close so reopening shows a fresh fetch, not stale results
  function handleOpenChange(next: boolean) {
    if (!next) {
      setLibrary({ status: 'idle' })
      setSelected(null)
      setPreview({ status: 'idle' })
      setFilter('')
      setActiveId(null)
    }
    onOpenChange(next)
  }

  function handleSelectEntry(entry: PromptLibraryEntry) {
    setSelected(entry)
    setPreview({ status: 'loading' })
    fetch(`/api/prompt-library/${entry.id}`)
      .then((r) => r.json())
      .then((data) => {
        if (data.error) setPreview({ status: 'error', message: data.error })
        else setPreview({ status: 'ok', data: data.entry })
      })
      .catch(() => setPreview({ status: 'error', message: 'Failed to load entry' }))
  }

  function handleUseAsBase() {
    if (preview.status !== 'ok' || !selected) return
    onSelect(preview.data.content, selected)
    handleOpenChange(false)
  }

  return (
    <Sheet open={open} onOpenChange={handleOpenChange}>
      <SheetContent side="right" className="w-full max-w-4xl flex flex-col p-0">
        <SheetHeader className="px-6 pt-6 pb-4 border-b">
          <SheetTitle>Prompt Archive</SheetTitle>
          <SheetDescription>
            Browse system prompt templates. Select one to use as a starting base for your agent&apos;s system prompt.
          </SheetDescription>
        </SheetHeader>

        <div className="flex flex-1 overflow-hidden">
          {/* Left column — category & entry list */}
          <div className="w-72 border-r flex flex-col">
            {library.status === 'ok' && (
              <div className="px-3 py-2 border-b">
                <Input
                  placeholder="Filter prompts…"
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                  className="h-8 text-sm"
                />
              </div>
            )}
            <ScrollArea className="flex-1">
              {(library.status === 'idle' || library.status === 'loading') && (
                <div className="flex items-center justify-center p-8">
                  <Loader2 className="animate-spin h-5 w-5 text-muted-foreground" />
                </div>
              )}
              {library.status === 'error' && (
                <div className="flex items-center gap-2 p-4 text-sm text-destructive">
                  <AlertCircle className="h-4 w-4 shrink-0" />
                  {library.message}
                </div>
              )}
              {library.status === 'ok' && (
                <div role="listbox" aria-label="Prompt templates" onKeyDown={handleListKeyDown}>
                  {filteredCategories.map((cat, catIndex) => (
                  <div key={cat.name} role="group" aria-labelledby={`prompt-cat-${catIndex}`} className="py-2">
                    <p id={`prompt-cat-${catIndex}`} className="px-4 py-1 text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                      {cat.name}
                    </p>
                    {cat.entries.map((entry) => (
                      <button
                        key={entry.id}
                        ref={(el) => {
                          if (el) entryRefs.current.set(entry.id, el)
                          else entryRefs.current.delete(entry.id)
                        }}
                        role="option"
                        aria-selected={selected?.id === entry.id}
                        tabIndex={entry.id === rovingId ? 0 : -1}
                        onClick={() => { setActiveId(entry.id); handleSelectEntry(entry) }}
                        className={`w-full text-left px-4 py-2 text-sm hover:bg-accent transition-colors flex items-start gap-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring ${
                          selected?.id === entry.id ? 'bg-accent' : ''
                        }`}
                      >
                        <FileText className="h-4 w-4 shrink-0 mt-0.5 text-muted-foreground" />
                        <span className="flex-1 min-w-0">
                          <span className="block font-medium truncate">{entry.title}</span>
                          {entry.description && (
                            <span className="block text-xs text-muted-foreground truncate">{entry.description}</span>
                          )}
                        </span>
                        {entry.charCount > MAX_PROMPT_CONTENT_CHARS && (
                          <Badge variant="outline" className="text-xs shrink-0">Large</Badge>
                        )}
                      </button>
                    ))}
                  </div>
                  ))}
                </div>
              )}
              {library.status === 'ok' && filter.trim() && filteredCategories.length === 0 && (
                <p className="px-4 py-6 text-xs text-muted-foreground text-center">
                  No prompts match &ldquo;{filter}&rdquo;
                </p>
              )}
            </ScrollArea>
          </div>

          {/* Right column — preview */}
          <div className="flex-1 flex flex-col overflow-hidden">
            {preview.status === 'idle' && (
              <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground">
                Select an entry to preview
              </div>
            )}
            {preview.status === 'loading' && (
              <div className="flex-1 flex items-center justify-center">
                <Loader2 className="animate-spin h-5 w-5 text-muted-foreground" />
              </div>
            )}
            {preview.status === 'error' && (
              <div className="flex-1 flex items-center gap-2 p-6 text-sm text-destructive">
                <AlertCircle className="h-4 w-4" /> {preview.message}
              </div>
            )}
            {preview.status === 'ok' && (
              <>
                <div className="px-6 py-3 border-b flex items-center justify-between gap-4">
                  <div>
                    <p className="font-medium text-sm">{preview.data.title}</p>
                    <p className="text-xs text-muted-foreground">
                      {preview.data.charCount.toLocaleString()} chars
                      {preview.data.truncated && ' — truncated to fit 10k limit'}
                    </p>
                  </div>
                  <Button size="sm" onClick={handleUseAsBase}>
                    Use as Base
                  </Button>
                </div>
                <ScrollArea className="flex-1 px-6 py-4">
                  <div className="prose prose-sm prose-invert max-w-none">
                    <ReactMarkdown>{preview.data.content}</ReactMarkdown>
                  </div>
                </ScrollArea>
              </>
            )}
          </div>
        </div>
      </SheetContent>
    </Sheet>
  )
}
