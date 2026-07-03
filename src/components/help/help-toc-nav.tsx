'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { Search, ChevronRight } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { TOC } from './toc'

/**
 * E-1: client island for the help route's sticky TOC — topic filter,
 * scroll-spy highlighting, and the '/' focus shortcut. The section content it
 * spies on is server-rendered by help-content.tsx; the island finds the
 * scroll container and section anchors in the DOM by id.
 */
export function HelpTocNav() {
  const [query, setQuery] = useState('')
  const [activeId, setActiveId] = useState<string>(() => TOC[0]?.items[0]?.id ?? '')
  const filterRef = useRef<HTMLInputElement>(null)

  // Scroll-spy via IntersectionObserver, scoped to the guide's scroll
  // container (#help-scroll-root, rendered by the server content).
  // rootMargin puts the active zone at the top ~140px of the container and
  // ignores the lower 60%, so the "active" item is whichever section has just
  // crossed the top of the visible area.
  useEffect(() => {
    const root = document.getElementById('help-scroll-root')
    if (!root) return
    const allIds = TOC.flatMap((g) => g.items.map((it) => it.id))
    const elements = allIds
      .map((id) => document.getElementById(id))
      .filter((el): el is HTMLElement => el !== null)

    const observer = new IntersectionObserver(
      (entries) => {
        // Pick the topmost intersecting section each tick. If nothing is
        // intersecting (e.g. a very long section that fills the viewport),
        // keep the previous activeId.
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)
        if (visible[0]) setActiveId(visible[0].target.id)
      },
      { root, rootMargin: '-140px 0px -60% 0px', threshold: 0 }
    )

    elements.forEach((el) => observer.observe(el))
    return () => observer.disconnect()
  }, [])

  // `/` focuses the filter input when the help page has focus (ignored inside
  // text fields so users can type slashes in search itself).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== '/') return
      const target = e.target as HTMLElement | null
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return
      e.preventDefault()
      filterRef.current?.focus()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const visibleTOC = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return TOC
    return TOC.map((g) => ({
      ...g,
      items: g.items.filter((it) => it.title.toLowerCase().includes(q) || g.label.toLowerCase().includes(q)),
    })).filter((g) => g.items.length > 0)
  }, [query])

  return (
    <aside className="lg:sticky lg:top-20 lg:self-start lg:max-h-[calc(100vh-6rem)] lg:overflow-auto pr-2 -mr-2">
      <div className="relative mb-4">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground/50" />
        <Input
          ref={filterRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Filter topics... (/)"
          aria-label="Filter help topics"
          className="h-8 pl-8 text-xs bg-surface/40 border-border/30"
        />
      </div>
      <nav aria-label="Help contents" className="space-y-5">
        {visibleTOC.length === 0 && (
          <p className="text-xs text-muted-foreground/60 italic">No topics match &ldquo;{query}&rdquo;.</p>
        )}
        {visibleTOC.map((group) => (
          <div key={group.label}>
            <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground/50 mb-1.5 px-2">
              {group.label}
            </div>
            <ul className="space-y-0.5">
              {group.items.map((item) => {
                const active = activeId === item.id
                return (
                  <li key={item.id}>
                    <a
                      href={`#${item.id}`}
                      aria-current={active ? 'location' : undefined}
                      className={`group flex items-center gap-1.5 px-2 py-1 rounded text-[12px] leading-tight transition-colors ${
                        active
                          ? 'bg-[var(--cobalt)]/10 text-foreground'
                          : 'text-muted-foreground/75 hover:text-foreground hover:bg-surface/40'
                      }`}
                    >
                      <ChevronRight className={`h-3 w-3 shrink-0 transition-opacity ${active ? 'opacity-100 text-[var(--cobalt-mid)]' : 'opacity-0 group-hover:opacity-40'}`} />
                      <span className="truncate">{item.title}</span>
                    </a>
                  </li>
                )
              })}
            </ul>
          </div>
        ))}
      </nav>
    </aside>
  )
}
