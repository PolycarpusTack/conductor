'use client'

import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import { ArrowLeft, Search, ChevronRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { APP_VERSION_SHORT } from '@/lib/version'

type Tone = 'cobalt' | 'teal' | 'amber' | 'purple' | 'neon'

// =============================================================================
// Help & User Guide
// A comprehensive in-app guide for Conductor.
// Organised into a sticky left-hand Table of Contents and right-hand content.
// Every anchor-linkable section is registered in TOC below so the sidebar,
// search filter and scroll-spy stay in sync.
// =============================================================================

type TocItem = { id: string; title: string }
type TocGroup = { label: string; items: TocItem[] }

const TOC: TocGroup[] = [
  {
    label: 'Release notes',
    items: [
      { id: 'help-release-0-3-0', title: "What's new in 0.3.0" },
      { id: 'help-release-0-2-0', title: "What's new in 0.2.0" },
      { id: 'help-release-0-1-0', title: "What's new in 0.1.0" },
      { id: 'help-release-0-6', title: "What's new in 0.6" },
      { id: 'help-release-0-5', title: "What's new in 0.5" },
      { id: 'help-release-0-4', title: "What's new in 0.4" },
      { id: 'help-release-0-3', title: "What's new in 0.3" },
      { id: 'help-release-0-2', title: "What's new in 0.2" },
      { id: 'help-release-0-1', title: "What's new in 0.1" },
    ],
  },
  {
    label: 'Getting Started',
    items: [
      { id: 'help-overview', title: 'What is Conductor?' },
      { id: 'help-audience', title: 'Who is this for?' },
      { id: 'help-concepts', title: 'Core concepts' },
      { id: 'help-quickstart', title: '10-minute quick start' },
      { id: 'help-first-project', title: 'Your first project, step by step' },
      { id: 'help-anatomy', title: 'Anatomy of the app' },
    ],
  },
  {
    label: 'The Board',
    items: [
      { id: 'help-board', title: 'The Kanban board' },
      { id: 'help-tasks', title: 'Creating and editing tasks' },
      { id: 'help-task-states', title: 'Task state machine' },
      { id: 'help-task-drawer', title: 'Task detail drawer' },
      { id: 'help-review-gates', title: 'Human review gates' },
    ],
  },
  {
    label: 'Agents',
    items: [
      { id: 'help-agents', title: 'What is an agent?' },
      { id: 'help-agent-create', title: 'Creating an agent' },
      { id: 'help-agent-roles', title: 'Agent roles' },
      { id: 'help-agent-invocation', title: 'HTTP vs. Daemon' },
      { id: 'help-agent-keys', title: 'Agent API keys' },
      { id: 'help-agent-status', title: 'Active, idle, and muted' },
    ],
  },
  {
    label: 'Modes',
    items: [
      { id: 'help-modes', title: 'What are modes?' },
      { id: 'help-modes-builtin', title: 'Built-in modes' },
      { id: 'help-modes-custom', title: 'Custom modes' },
      { id: 'help-modes-permissions', title: 'Scoped tool permissions' },
    ],
  },
  {
    label: 'Chains & Workflows',
    items: [
      { id: 'help-chains', title: 'What is a chain?' },
      { id: 'help-chain-templates', title: 'Chain templates' },
      { id: 'help-chain-builder', title: 'Using the chain builder' },
      { id: 'help-workflow-editor', title: 'Workflow editor' },
      { id: 'help-handoffs', title: 'Automatic handoffs' },
    ],
  },
  {
    label: 'Skills Library',
    items: [
      { id: 'help-skills', title: 'Skills overview' },
      { id: 'help-skills-search', title: 'Semantic search' },
      { id: 'help-skills-create', title: 'Creating skills' },
    ],
  },
  {
    label: 'MCP Connections',
    items: [
      { id: 'help-mcp', title: 'What is MCP?' },
      { id: 'help-mcp-connect', title: 'Connecting a server' },
      { id: 'help-mcp-tools', title: 'Tool execution loop' },
    ],
  },
  {
    label: 'Runtimes',
    items: [
      { id: 'help-runtimes', title: 'What is a runtime?' },
      { id: 'help-runtimes-add', title: 'Adding a runtime' },
    ],
  },
  {
    label: 'Templates',
    items: [
      { id: 'help-templates', title: 'Task templates' },
      { id: 'help-chain-templates-ref', title: 'Chain templates reference' },
    ],
  },
  {
    label: 'Automation',
    items: [
      { id: 'help-automation', title: 'Automation overview' },
      { id: 'help-automation-dispatch', title: 'Auto-dispatch rules' },
    ],
  },
  {
    label: 'Integrations',
    items: [
      { id: 'help-integrations', title: 'Triggers & Reactions overview' },
      { id: 'help-integrations-triggers', title: 'Triggers' },
      { id: 'help-integrations-reactions', title: 'Reactions' },
      { id: 'help-integrations-templates', title: 'Mustache templates' },
      { id: 'help-integrations-failures', title: 'Failure handling' },
    ],
  },
  {
    label: 'Observability',
    items: [
      { id: 'help-obs-runtime', title: 'Runtime dashboard' },
      { id: 'help-obs-agent', title: 'Agent activity dashboard' },
      { id: 'help-obs-overview', title: 'Observability dashboard' },
      { id: 'help-obs-daemon-log', title: 'Daemon log viewer' },
      { id: 'help-obs-step-output', title: 'Step output viewer' },
      { id: 'help-obs-attempts', title: 'Attempt comparison' },
      { id: 'help-obs-artifacts', title: 'Artifacts' },
    ],
  },
  {
    label: 'Settings',
    items: [
      { id: 'help-settings-general', title: 'General' },
      { id: 'help-settings-agents', title: 'Agents' },
      { id: 'help-settings-api', title: 'API keys' },
      { id: 'help-settings-activity', title: 'Activity log' },
      { id: 'help-settings-modes', title: 'Modes' },
      { id: 'help-settings-runtimes', title: 'Runtimes' },
      { id: 'help-settings-mcp', title: 'MCP' },
      { id: 'help-settings-templates', title: 'Templates' },
      { id: 'help-settings-analytics', title: 'Analytics' },
      { id: 'help-settings-automation', title: 'Automation' },
      { id: 'help-settings-integrations', title: 'Integrations' },
    ],
  },
  {
    label: 'Daemon mode',
    items: [
      { id: 'help-daemon', title: 'Daemon mode overview' },
      { id: 'help-daemon-setup', title: 'Setting up the daemon' },
      { id: 'help-daemon-heartbeat', title: 'Heartbeat & registration' },
      { id: 'help-daemon-steps', title: 'Claiming steps' },
    ],
  },
  {
    label: 'APIs (advanced)',
    items: [
      { id: 'help-api-cli', title: 'CLI-style API' },
      { id: 'help-api-http', title: 'HTTP agent API' },
      { id: 'help-api-auth', title: 'Authentication' },
    ],
  },
  {
    label: 'Security',
    items: [
      { id: 'help-security', title: 'Admin login & session' },
      { id: 'help-security-keys', title: 'Key storage' },
      { id: 'help-security-rotation', title: 'Key rotation' },
    ],
  },
  {
    label: 'Troubleshooting',
    items: [
      { id: 'help-trouble-ws', title: 'WebSocket shows Offline' },
      { id: 'help-trouble-stuck', title: 'A task is stuck' },
      { id: 'help-trouble-agent', title: "An agent won't claim" },
      { id: 'help-trouble-daemon', title: 'Daemon keeps disconnecting' },
      { id: 'help-trouble-clear', title: 'Clearing data & reset' },
    ],
  },
  {
    label: 'Reference',
    items: [
      { id: 'help-faq', title: 'FAQ' },
      { id: 'help-glossary', title: 'Glossary' },
      { id: 'help-shortcuts', title: 'Keyboard shortcuts' },
      { id: 'help-storage', title: 'Where data is stored' },
    ],
  },
]

// =============================================================================
// Primitive building blocks
// =============================================================================

function Section({ id, title, subtitle, children }: { id: string; title: React.ReactNode; subtitle?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section id={id} className="scroll-mt-24 pb-12 mb-12 border-b border-border/20 last:border-0">
      <h2 className="text-2xl font-semibold font-heading tracking-tight mb-1">{title}</h2>
      {subtitle && <p className="text-sm text-muted-foreground/70 mb-6">{subtitle}</p>}
      <div className={`${subtitle ? '' : 'mt-4'} prose-help space-y-4 text-sm leading-[1.65] text-foreground/85`}>
        {children}
      </div>
    </section>
  )
}

function H3({ id, children }: { id?: string; children: React.ReactNode }) {
  return (
    <h3 id={id} className="scroll-mt-24 text-base font-semibold text-foreground mt-6 mb-2 tracking-tight">
      {children}
    </h3>
  )
}

function Callout({ tone = 'cobalt', title, children }: { tone?: Tone; title?: React.ReactNode; children: React.ReactNode }) {
  const palette: Record<Tone, string> = {
    cobalt: 'border-[var(--cobalt)]/30 bg-[var(--cobalt)]/5',
    teal: 'border-[var(--op-teal-dim)] bg-[var(--op-teal-bg)]',
    amber: 'border-[var(--op-amber-dim)] bg-[var(--op-amber-bg)]',
    purple: 'border-[var(--op-purple-dim)] bg-[var(--op-purple-bg)]',
    neon: 'border-[var(--neon-green)]/30 bg-[var(--neon-green)]/5',
  }
  const titleColor: Record<Tone, string> = {
    cobalt: 'text-[var(--cobalt-mid)]',
    teal: 'text-[var(--op-teal)]',
    amber: 'text-[var(--op-amber)]',
    purple: 'text-[var(--op-purple)]',
    neon: 'text-[var(--neon-green)]',
  }
  return (
    <div className={`rounded-lg border px-4 py-3 ${palette[tone]}`}>
      {title && <div className={`text-[11px] font-semibold uppercase tracking-wider mb-1 ${titleColor[tone]}`}>{title}</div>}
      <div className="text-foreground/85 space-y-2 text-sm leading-[1.6]">{children}</div>
    </div>
  )
}

// --- Head First / For Dummies signature boxes -------------------------------
// These wrap Callout with a consistent, recognisable visual language:
// readers learn to skim for the icon they need.

function PlainEnglish({ children }: { children: React.ReactNode }) {
  return <Callout tone="neon" title="🗣 In plain English">{children}</Callout>
}

function TipBox({ children }: { children: React.ReactNode }) {
  return <Callout tone="teal" title="💡 Tip">{children}</Callout>
}

function WatchIt({ children }: { children: React.ReactNode }) {
  return <Callout tone="amber" title="⚠️ Watch it!">{children}</Callout>
}

function RememberBox({ children }: { children: React.ReactNode }) {
  return <Callout tone="purple" title="🧠 Remember">{children}</Callout>
}

function TechStuff({ children }: { children: React.ReactNode }) {
  return <Callout tone="cobalt" title="🤓 Technical stuff (safe to skip)">{children}</Callout>
}

/** Head First-style Q&A block. Pass [question, answer] pairs. */
function DumbQuestions({ items }: { items: Array<[React.ReactNode, React.ReactNode]> }) {
  return (
    <div className="rounded-lg border border-[var(--op-purple-dim)] bg-[var(--op-purple-bg)] px-4 py-3 space-y-3">
      <div className="text-[11px] font-semibold uppercase tracking-wider text-[var(--op-purple)]">
        🙋 There are no dumb questions
      </div>
      {items.map(([q, a], i) => (
        <div key={i} className="space-y-1">
          <p className="text-sm font-semibold text-foreground/90">Q: {q}</p>
          <p className="text-sm leading-[1.6] text-foreground/80">A: {a}</p>
        </div>
      ))}
    </div>
  )
}

/** Head First-style exercise box. */
function TryIt({ title = 'Sharpen your pencil', children }: { title?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-dashed border-[var(--op-teal-dim)] bg-[var(--op-teal-bg)] px-4 py-3">
      <div className="text-[11px] font-semibold uppercase tracking-wider mb-1 text-[var(--op-teal)]">
        ✏️ {title}
      </div>
      <div className="text-foreground/85 space-y-2 text-sm leading-[1.6]">{children}</div>
    </div>
  )
}

function Steps({ children }: { children: React.ReactNode }) {
  return <ol className="list-decimal space-y-3 pl-5 marker:text-muted-foreground/50 marker:font-semibold">{children}</ol>
}

function Step({ title, children }: { title: React.ReactNode; children?: React.ReactNode }) {
  return (
    <li className="pl-1">
      <span className="font-semibold text-foreground">{title}</span>
      {children ? <span className="ml-1 text-foreground/75">{children}</span> : null}
    </li>
  )
}

function Bullets({ children }: { children: React.ReactNode }) {
  return <ul className="list-disc space-y-1.5 pl-5 marker:text-muted-foreground/40">{children}</ul>
}

function Term({ children }: { children: React.ReactNode }) {
  return <code className="text-[12px] rounded bg-surface/60 border border-border/30 px-1.5 py-[1px] font-mono text-[var(--op-teal)]">{children}</code>
}

function Kbd({ children }: { children: React.ReactNode }) {
  return <kbd className="text-[11px] rounded bg-surface/80 border border-border/40 px-1.5 py-[1px] font-mono text-foreground/85 shadow-[inset_0_-1px_0_rgba(0,0,0,0.25)]">{children}</kbd>
}

function Ref({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a href={href} className="text-[var(--cobalt-mid)] hover:text-[var(--cobalt)] underline decoration-dotted underline-offset-2">
      {children}
    </a>
  )
}

function Table({ head, rows }: { head: React.ReactNode[]; rows: React.ReactNode[][] }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-border/30 bg-card/40">
      <table className="w-full text-xs">
        <thead className="bg-surface/40">
          <tr>
            {head.map((h, i) => (
              <th key={i} className="text-left font-semibold text-foreground/80 px-3 py-2 border-b border-border/30">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-b border-border/15 last:border-0">
              {r.map((c, j) => (
                <td key={j} className="px-3 py-2 align-top text-foreground/80">{c}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// =============================================================================
// Main component
// =============================================================================

export function HelpPage({ onBack }: { onBack: () => void }) {
  const [query, setQuery] = useState('')
  const [activeId, setActiveId] = useState<string>(() => TOC[0]?.items[0]?.id ?? '')
  const scrollRef = useRef<HTMLDivElement>(null)
  const filterRef = useRef<HTMLInputElement>(null)

  // Scroll-spy via IntersectionObserver, scoped to this page's scroll container.
  // rootMargin puts the active zone at the top ~140px of the container and
  // ignores the lower 60%, so the "active" item is whichever section has just
  // crossed the top of the visible area.
  useEffect(() => {
    const root = scrollRef.current
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
    <div ref={scrollRef} className="h-[calc(100vh-3.5rem)] overflow-auto">
      <div className="mx-auto max-w-[1400px] px-6 py-8">
        {/* Page header */}
        <header className="mb-8 flex items-start justify-between gap-6 flex-wrap">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-[11px] uppercase tracking-wider text-muted-foreground/60 mb-1">
              <span>Conductor {APP_VERSION_SHORT}</span>
              <span className="text-muted-foreground/30">·</span>
              <span>Help &amp; User Guide</span>
            </div>
            <h1 className="text-3xl font-bold font-heading tracking-tight">Everything you need to know about Conductor</h1>
            <p className="text-sm text-muted-foreground mt-2 max-w-2xl">
              A plain-English tour of the platform: what each feature does, how to click through it, and when to reach for it.
              Written for operators and project leads as much as for developers — if a section uses a term you don&apos;t recognise,
              check the <Ref href="#help-glossary">Glossary</Ref>.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={onBack} className="h-8">
              <ArrowLeft className="h-3.5 w-3.5 mr-1" />
              Back to Board
            </Button>
          </div>
        </header>

        <div className="grid grid-cols-1 lg:grid-cols-[240px_1fr] gap-10">
          {/* Sticky TOC */}
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

          {/* Content */}
          <article className="min-w-0 max-w-3xl">
            {/* ════════════════════════════════════════════════════════════════
                RELEASE NOTES
               ════════════════════════════════════════════════════════════════ */}

            <Section
              id="help-release-0-3-0"
              title="What's new in 0.3.0"
              subtitle="Modes become policy, tasks get templates, and automation grows a rules engine."
            >
              <Callout tone="neon" title="The headline">
                <p>
                  0.3.0 completes the settings roadmap (S1&ndash;S7). Modes now carry real policy — retry
                  budgets, tool allowlists, output-format hints. Task templates prefill the create dialog.
                  And the new <strong>automation rules engine</strong> lets triggers point inward: auto-assign
                  agents, set priorities and retry policies, archive old work, and escalate stale review
                  gates — with dry-run rehearsal and a hard no-cascade guarantee.
                </p>
              </Callout>

              <H3 id="help-release-0-3-0-modes">Mode policy depth (S4)</H3>
              <Bullets>
                <li><strong>Per-mode max attempts</strong> — steps created in a mode inherit its retry budget; explicit step settings still win.</li>
                <li><strong>Tool allowlists</strong> — exact names or <code>connection__*</code> globs narrow MCP tools after the built-in read-only heuristics; a tool must survive every layer to reach an agent.</li>
                <li><strong>Output-format hints</strong> — markdown / JSON / diff / plain, appended to the mode instructions at dispatch.</li>
              </Bullets>

              <H3 id="help-release-0-3-0-templates">Task templates (S6)</H3>
              <Bullets>
                <li><strong>Saved task forms</strong> — title pattern (with <code>{'{date}'}</code> expansion), description, priority, tag, notes, and an attached chain template.</li>
                <li><strong>Start from template</strong> — a picker at the top of the create-task dialog prefills everything, step builder included. It&apos;s a prefill, not a lock.</li>
              </Bullets>

              <H3 id="help-release-0-3-0-automation">Automation rules engine (S7)</H3>
              <Bullets>
                <li><strong>Internal actions</strong> — <code>task:assign</code>, <code>task:set-priority</code>, <code>task:set-retry</code>, <code>task:archive</code>, <code>step:escalate</code> ride the same trigger/reaction pipeline as Slack and Jira, with structured config forms.</li>
                <li><strong>Safety rails</strong> — automations can never trigger automations, every action is idempotent, every firing is audited, and a dry-run toggle rehearses rules without executing them.</li>
                <li><strong>Time-based rules</strong> — an hourly sweep emits <Term>task-stale</Term> and <Term>review-gate-stale</Term> events; pair them with internal actions to auto-archive DONE work or escalate forgotten human gates.</li>
                <li><strong>Archive &ne; delete</strong> — archived tasks leave the board but live forever in <em>Settings &rarr; Activity &rarr; Archived Tasks</em>.</li>
              </Bullets>
            </Section>

            <Section
              id="help-release-0-2-0"
              title="What's new in 0.2.0"
              subtitle="Agent messaging, content safety, evidence packets, and the deployment doctor."
            >
              <Callout tone="neon" title="The headline">
                <p>
                  0.2.0 completes the operations layer. Agents now communicate through durable, task-aware
                  inboxes; every untrusted input is scanned for prompt injection and quarantined as data when
                  flagged; each step execution can show an <strong>evidence packet</strong> binding its output to
                  the memories, tool calls, sessions, and messages it relied on; and <code>bun run doctor</code>{' '}
                  verifies a deployment end to end.
                </p>
              </Callout>

              <H3 id="help-release-0-2-0-messaging">Agent messaging</H3>
              <Bullets>
                <li><strong>Project-scoped inboxes</strong> — agents send/read via their API keys (<code>/api/agent/messages</code>); statuses flow queued → delivered → read with thread support.</li>
                <li><strong>Task threads</strong> — a Messages section in the task drawer shows the conversation; admins can message agents as <code>admin@conductor</code>.</li>
                <li><strong>Safety built in</strong> — every body is scanned at send; flagged content is delivered wrapped as data while admins see the original.</li>
              </Bullets>

              <H3 id="help-release-0-2-0-safety">Content safety</H3>
              <Bullets>
                <li><strong>Injection scanner</strong> — instruction-override, role-hijack, prompt-exfiltration, and tool-abuse patterns; conservative by design.</li>
                <li><strong>Scan-always, wrap-when-flagged</strong> — MCP tool results, webhook-created tasks, and trigger payloads pass through untouched unless suspicious; flagged content gets an explicit DATA-ONLY envelope and a warning in the activity log.</li>
              </Bullets>

              <H3 id="help-release-0-2-0-evidence">Evidence packets</H3>
              <p>
                Expand <em>Show evidence</em> on any step to see what the agent relied on: injected memories by
                category, MCP tool calls with durations, linked execution sessions, task messages, and aggregated
                safety flags — assembled live from the audit trail, never a stale snapshot.
              </p>

              <H3 id="help-release-0-2-0-doctor">Deployment doctor</H3>
              <Bullets>
                <li><code>bun run doctor</code> — runtime, env validation, Prisma client, database, runtimes, daemons, plus live server and realtime checks.</li>
                <li><code>bun run smoke-test</code> — the strict variant for post-deploy gates; network checks must pass.</li>
                <li><strong>CI runs the offline doctor</strong> on every push.</li>
              </Bullets>
            </Section>

            <Section
              id="help-release-0-1-0"
              title="What's new in 0.1.0"
              subtitle="The operations layer: hosts, live sessions, and terminal-backed execution."
            >
              <Callout tone="neon" title="The headline">
                <p>
                  0.1.0 makes daemon agents visible as live workers instead of black-box pollers. Machines are
                  first-class <strong>Hosts</strong>, daemons report observable <strong>execution sessions</strong> with
                  live output, and workflow steps can run inside persistent local sessions declared by runtime policy —
                  all watch-only from the browser, by design.
                </p>
              </Callout>

              <H3 id="help-release-0-1-0-hosts">Host presence</H3>
              <Bullets>
                <li><strong>Hosts tab</strong> — every machine running a daemon, with online/stale/offline status, capability badges, trust level, and daemon counts. Daemons carry a persisted installation ID so a machine keeps one identity across re-registrations.</li>
                <li><strong>Heartbeat metrics</strong> — CPU/memory/in-flight work folded into host metadata.</li>
              </Bullets>

              <H3 id="help-release-0-1-0-sessions">Session observation</H3>
              <Bullets>
                <li><strong>Sessions tab + task drawer</strong> — each daemon-reported session shows status, backend, command, and a bounded output tail with <strong>secrets redacted before storage and broadcast</strong>.</li>
                <li><strong>Watch-only</strong> — there is deliberately no way to type into a session from the browser.</li>
              </Bullets>

              <H3 id="help-release-0-1-0-terminal">Terminal-backed execution</H3>
              <Bullets>
                <li><strong>Session policies</strong> — runtime config declares <code>ephemeral</code> / <code>persistent-agent</code> / <code>persistent-task</code> / <code>persistent-step</code> with a command template; the server computes session keys so reuse semantics live in one place.</li>
                <li><strong>Audit parity</strong> — daemon steps now write the same started/succeeded/failed/retry event trail as HTTP dispatch, with the executing session linked.</li>
                <li><strong>Reference daemon</strong> — <code>mini-services/conductor-daemon</code> proves the whole protocol; its safety default never executes step instructions as shell.</li>
              </Bullets>
            </Section>

            <Section
              id="help-release-0-6"
              title="What's new in 0.6"
              subtitle="Security hardening, durable execution, tracing, and operational polish."
            >
              <Callout tone="neon" title="The headline">
                <p>
                  0.6 is the &ldquo;production-ready&rdquo; release. CSRF protection and scoped API keys harden the
                  surface, the execution pipeline gained an audit trail with exponential backoff and a dead-letter
                  queue, OpenTelemetry traces follow a task from HTTP request to LLM call, and a health endpoint
                  plus install guide make self-hosting verifiable.
                </p>
              </Callout>

              <H3 id="help-release-0-6-security">Security pass</H3>
              <Bullets>
                <li><strong>CSRF origin checks</strong> — every session-authenticated mutation route rejects cross-origin requests.</li>
                <li><strong>Startup env validation</strong> — a misconfigured deployment fails at boot with a readable message instead of a runtime surprise; see <code>.env.example</code>.</li>
                <li><strong>Scoped API keys</strong> — issue keys with <code>read</code>/<code>write</code> scopes from <code>/api/admin/api-keys</code>; only an 8-char prefix and a SHA-256 hash are stored. CI and webhooks can pull activity/analytics and create tasks without a browser session.</li>
              </Bullets>

              <H3 id="help-release-0-6-hardening">Execution hardening</H3>
              <Bullets>
                <li><strong>Step event log</strong> — an append-only audit trail per step (<code>leased</code>, <code>started</code>, <code>succeeded</code>, <code>failed</code>, <code>retry_scheduled</code>, <code>dead_lettered</code>), visible in the execution history panel.</li>
                <li><strong>Exponential backoff</strong> — retries now back off with jitter (capped at 1 hour) instead of a fixed delay.</li>
                <li><strong>Dead-letter queue</strong> — steps that exhaust retries (and their fallback agent) are snapshotted; review and requeue them from <em>Settings &rarr; Activity</em>.</li>
                <li><strong>Race-safe dispatch</strong> — two workers can no longer run the same attempt; the loser aborts cleanly.</li>
              </Bullets>

              <H3 id="help-release-0-6-observability">Tracing &amp; health</H3>
              <Bullets>
                <li><strong>OpenTelemetry</strong> — route and adapter spans with model, token, and cost attributes; set <code>OTEL_EXPORTER_OTLP_ENDPOINT</code> to export. Trace context follows a step from the creating request through dispatch to the daemon.</li>
                <li><strong>Health endpoints</strong> — <code>GET /api/health</code> for load balancers (DB + env checks), and a per-runtime LLM connectivity ping for admins.</li>
                <li><strong>Install guide</strong> — <code>INSTALL.md</code> documents setup end to end, including the optional Postgres + pgvector and realtime services.</li>
              </Bullets>

              <H3 id="help-release-0-6-tests">Test coverage</H3>
              <p>
                The suite grew from 180 to 250+ tests, including endpoint-level auth tests that catch any route
                missing its session check, CSRF coverage on mutation routes, and unit tests for every new
                security and hardening module.
              </p>
            </Section>

            <Section
              id="help-release-0-5"
              title="What's new in 0.5"
              subtitle="Activity log, log retention, structured tracing, and a green CI baseline."
            >
              <Callout tone="neon" title="The headline">
                <p>
                  0.5 is the &ldquo;trust the system&rdquo; release. A structured activity log gives every agent action
                  a searchable, filterable audit trail. Per-project log retention keeps storage bounded. A GitHub Actions
                  pipeline enforces a green build on every merge so regressions are caught before they reach production.
                </p>
              </Callout>

              <H3 id="help-release-0-5-activity">Structured activity log</H3>
              <p>
                Every agent action, tool call, and step transition is now written to a structured log with{' '}
                <strong>level</strong> (<code>debug</code> / <code>info</code> / <code>warn</code> / <code>error</code>),
                {' '}<strong>component</strong> (<code>task</code> / <code>agent</code> / <code>daemon</code> / <code>wizard</code> / <code>runtime</code>),
                and an optional <strong>trace ID</strong> that links related events across components.
                Access it in <em>Settings &rarr; Activity</em>.
              </p>
              <Bullets>
                <li><strong>Filter by level</strong> — surface only warnings and errors without scrolling through info noise.</li>
                <li><strong>Filter by component</strong> — isolate daemon logs, wizard logs, or a specific agent.</li>
                <li><strong>Trace ID search</strong> — paste a trace ID to see every event from a single request end-to-end.</li>
                <li><strong>Full-text search</strong> — filter the log table by any keyword.</li>
                <li><strong>Export</strong> — download as JSONL or CSV for offline analysis or incident review.</li>
              </Bullets>

              <H3 id="help-release-0-5-retention">Log retention &amp; automatic purge</H3>
              <p>
                Configure how long logs are kept in <em>Settings &rarr; Activity &rarr; Log Retention</em>.
                Options range from 7 days to 1 year, or keep logs forever. Logs older than the retention window
                are purged automatically in the background each time the activity feed is loaded — no cron job required.
                You can also trigger an immediate purge with the <em>Purge now</em> button.
              </p>

              <H3 id="help-release-0-5-ci">CI &amp; build discipline</H3>
              <Bullets>
                <li><strong>GitHub Actions pipeline</strong> — every push and pull request to <code>main</code> runs schema validation, stale-client detection, type-check, lint, tests, and build in the correct order.</li>
                <li><strong>Stale Prisma client detection</strong> — CI regenerates the Prisma client and fails the build if the committed client is out of sync with the schema, so schema changes can never silently break TypeScript.</li>
                <li><strong>Auto-generate on install</strong> — <code>bun install</code> now runs <code>prisma generate</code> automatically via a postinstall hook, so a fresh clone is always ready to type-check immediately.</li>
              </Bullets>

              <H3 id="help-release-0-5-roadmap">What comes next</H3>
              <p>
                Upcoming work includes auth test coverage, CSRF protection on admin routes, scoped API keys,
                execution hardening (idempotency, dead-letter, exponential backoff), OpenTelemetry tracing,
                and a Pino-based structured logger. See the implementation plans in{' '}
                <code>docs/superpowers/plans/</code> for the full roadmap.
              </p>
            </Section>

            <Section
              id="help-release-0-4"
              title="What's new in 0.4"
              subtitle="Integrations: Triggers, Reactions, and external event automation."
            >
              <Callout tone="neon" title="The headline">
                <p>
                  0.4 ships the Triggers + Reactions system — project-scoped automation that connects AgentBoard
                  to the outside world. Internal events (chain completed, step failed, task created) and Sentry
                  alerts can now fire sequential chains of typed reactions: Slack messages, HTTP calls, Jira issue
                  creation, and email.
                </p>
              </Callout>

              <H3 id="help-release-0-4-integrations">Triggers &amp; Reactions</H3>
              <p>
                Configure Triggers in <em>Settings &rarr; Integrations</em>. Each Trigger listens for an event
                (or polls Sentry on a 60-second interval) and runs one or more Reactions in order. Reaction outputs
                are available as Mustache variables for the next step in the chain — so a Jira ticket created in
                reaction 1 can be referenced as <code>{'{{reactions.create_jira.issueKey}}'}</code> in reaction 2&apos;s
                Slack message. See <Ref href="#help-integrations">Triggers &amp; Reactions</Ref> for the full reference.
              </p>

              <H3 id="help-release-0-4-cleanup">Codebase cleanup</H3>
              <Bullets>
                <li>Removed orphaned dead code (prompt-templates module, unused constants, dead state in page).</li>
                <li>Artifact saves in dispatch now use a single <code>createMany</code> instead of sequential writes.</li>
              </Bullets>
            </Section>

            <Section
              id="help-release-0-3"
              title="What's new in 0.3"
              subtitle="Human review gates, durable execution, observability — plus a full in-app user guide."
            >
              <Callout tone="neon" title="The headline">
                <p>
                  0.3 is the &ldquo;run it in production&rdquo; release. Human review gates let you pause a workflow
                  for approval, a durable execution layer keeps long-running chains alive across restarts, and a
                  redesigned observability stack shows what each agent and step is doing.
                </p>
              </Callout>

              <H3 id="help-release-0-3-gates">Human review gates</H3>
              <p>
                Any step in a chain can now be marked as &ldquo;requires human approval&rdquo;. When the workflow
                reaches that step, the task moves to the <Term>REVIEW</Term> column and work pauses until a person
                clicks <em>Approve</em> or <em>Reject</em>. Rejections carry feedback back to the previous agent so
                it can try again. See <Ref href="#help-review-gates">Human review gates</Ref>.
              </p>

              <H3 id="help-release-0-3-durable">Durable execution</H3>
              <p>
                Chains now use a durable step queue. If the app restarts mid-workflow, the state machine picks up
                exactly where it left off — no lost work, no double-runs. Steps are idempotent by key, and each
                attempt is logged so you can compare tries side-by-side in the
                {' '}<Ref href="#help-obs-attempts">Attempt comparison</Ref> viewer.
              </p>

              <H3 id="help-release-0-3-obs">Observability overhaul</H3>
              <Bullets>
                <li><strong>Runtime dashboard</strong> — live view of active agents, step queue depth, and throughput.</li>
                <li><strong>Agent activity dashboard</strong> — per-agent history, claim rate, failure rate, time-in-state.</li>
                <li><strong>Observability dashboard</strong> — cross-project KPIs: tasks completed, cycle time, review gate wait time.</li>
                <li><strong>Daemon log viewer</strong> — stream stdout/stderr from each daemon-mode agent in the browser.</li>
                <li><strong>Step output viewer</strong> — every step&apos;s prompt, response, tool calls, and artifacts on one pane.</li>
              </Bullets>

              <H3 id="help-release-0-3-help">In-app Help &amp; User Guide</H3>
              <p>
                The page you&apos;re reading. Opened from the <Kbd>?</Kbd> icon in the top bar. Searchable, anchor-linked,
                and kept next to the product itself so what you read reflects what you&apos;re running.
              </p>

              <H3 id="help-release-0-3-polish">Polish &amp; fixes</H3>
              <Bullets>
                <li><strong>Mode-scoped permissions</strong> — custom modes can now restrict which tools an agent may call.</li>
                <li><strong>Chain builder</strong> — drag-to-reorder steps; inline validation catches missing handoff targets on save.</li>
                <li><strong>WebSocket reconnect</strong> — the <Term>Live</Term> badge recovers cleanly after network drops instead of wedging.</li>
                <li><strong>Daemon terminal fail</strong> — a crashed daemon-mode step now drives the task state machine the same way an HTTP failure does, so tasks never silently stick in <Term>IN_PROGRESS</Term>.</li>
                <li><strong>Route error handling</strong> — <Term>withErrorHandling</Term> is now compatible with Next.js route validators; expect fewer 500s with empty bodies.</li>
              </Bullets>

              <H3 id="help-release-0-3-roadmap">What came next</H3>
              <p>
                External-event integrations shipped in 0.4 — see <Ref href="#help-release-0-4">What&apos;s new in 0.4</Ref>.
                Chains can now be triggered by events and push results to Slack, Jira, HTTP endpoints, and email.
              </p>
            </Section>

            <Section
              id="help-release-0-2"
              title="What's new in 0.2"
              subtitle="Chains, skills, MCP, and the daemon."
            >
              <H3>Workflow chains</H3>
              <p>
                Replaced ad-hoc agent handoffs with first-class <strong>chains</strong>: an ordered list of steps,
                each bound to a mode and an agent, with explicit success and failure transitions. Chains can be saved
                as <Ref href="#help-chain-templates">templates</Ref> and reused across projects.
              </p>

              <H3>Skills library with semantic search</H3>
              <p>
                A shared library of reusable prompt fragments, code snippets, and playbooks. Agents can retrieve skills
                by semantic similarity (via <code>pgvector</code> when PostgreSQL is configured) or by exact tag match
                when running on SQLite.
              </p>

              <H3>MCP tool execution loop</H3>
              <p>
                Agents can call tools exposed by <strong>MCP</strong> servers (Model Context Protocol — a standard way
                for LLMs to invoke functions on external services). Each project picks which MCP connections its agents
                can see.
              </p>

              <H3>Daemon invocation mode</H3>
              <p>
                Besides being driven over HTTP, agents can now run as long-lived <strong>daemons</strong> that register
                with the server, heartbeat, and pull work from a step queue. Daemons are better for CLI-backed agents
                (Claude Code, OpenCode, Aider, etc.) that benefit from reusing a process.
              </p>
            </Section>

            <Section
              id="help-release-0-1"
              title="What's new in 0.1"
              subtitle="The initial public release."
            >
              <Bullets>
                <li>Kanban board with four columns — Backlog, In Progress, Review, Done — and drag-and-drop.</li>
                <li>Multi-project support and a workspace switcher.</li>
                <li>Agent creation with emoji, color, role, and provider.</li>
                <li>CLI-style and HTTP APIs for agents to claim, start, and complete tasks.</li>
                <li>Real-time updates over WebSocket (the <Term>Live</Term> badge in the top bar).</li>
                <li>Activity log capturing every agent action with full audit trail.</li>
                <li>Admin password protection and per-agent API keys.</li>
              </Bullets>
            </Section>

            {/* ════════════════════════════════════════════════════════════════
                GETTING STARTED
               ════════════════════════════════════════════════════════════════ */}

            <Section
              id="help-overview"
              title="What is Conductor?"
              subtitle="Relax. It's a Kanban board — with AI workers attached. You already know how to use half of it."
            >
              <p>
                Picture a restaurant kitchen. Orders come in, the head chef puts each ticket on the rail, and
                different cooks grab the tickets they know how to make. Nobody yells the whole menu at one
                overwhelmed cook. <strong>Conductor is that ticket rail — for AI agents.</strong> You write the
                ticket (a task), your cast of agents picks it up, each does the part it&apos;s good at, and you
                taste the dish before it leaves the kitchen.
              </p>

              <PlainEnglish>
                <p>
                  Conductor lets you run a <em>team</em> of AI agents instead of one chatbot. Each agent gets a
                  job description. Tasks flow across a board you can see. You approve anything important before
                  it ships. Everything gets written down.
                </p>
              </PlainEnglish>

              <p>
                Why does this beat the copy-paste-between-chatbots routine you&apos;ve probably been doing? Because
                copy-paste has three silent killers: you forget a step, you lose track of which version was the
                good one, and nobody can tell afterwards what actually happened. Conductor fixes all three: every
                task is a card on a board, every agent has a status light, and every decision — automated or
                human — leaves a timestamped record.
              </p>

              <H3>Conductor shines when…</H3>
              <Bullets>
                <li><strong>The work has stages</strong> — research &rarr; draft &rarr; review &rarr; ship, with a different specialist at each stage. (Sound like your job? Exactly.)</li>
                <li><strong>A human needs the final say</strong> — the agent does 90%, you approve the last mile. No surprises in production.</li>
                <li><strong>You mix providers</strong> — Claude for analysis, a local model for code, GPT for copy. One board, many brains.</li>
                <li><strong>Someone will ask &ldquo;what happened?&rdquo;</strong> — every prompt, output, tool call, and approval is on the record.</li>
              </Bullets>

              <H3>And what it&apos;s not (so you don&apos;t buy the wrong thing)</H3>
              <Bullets>
                <li><strong>Not a chat window.</strong> Want to chat with a model? Use the provider&apos;s own app. Conductor is for <em>work</em>, not conversation.</li>
                <li><strong>Not your team&apos;s Jira.</strong> Cards here are work units <em>for agents</em>. Keep your human backlog where it lives today.</li>
                <li><strong>Not a model gym.</strong> Conductor orchestrates models you already have keys for. It doesn&apos;t train or fine-tune anything.</li>
              </Bullets>

              <RememberBox>
                <p>
                  One sentence to keep: <strong>Conductor owns the work; agents do the work; you approve the
                  work.</strong> Every feature in this guide is just a variation on that sentence.
                </p>
              </RememberBox>
            </Section>

            <Section id="help-audience" title="Who is this for?" subtitle="Find yourself below and we'll tell you which chapters to read (and which to happily skip).">
              <p>
                Nobody reads documentation cover to cover — and you shouldn&apos;t either. Pick your character:
              </p>
              <Bullets>
                <li><strong>&ldquo;I run the show&rdquo;</strong> (operators, project leads) — you set up projects, hire the agent cast, and approve their work. Read Getting Started, The Board, Agents, Modes, and Chains. That&apos;s your whole world.</li>
                <li><strong>&ldquo;I automate everything I touch twice&rdquo;</strong> (power users) — add Automation, Templates, and Integrations to the list above. You&apos;ll be dangerous within an hour.</li>
                <li><strong>&ldquo;I write code that talks to this thing&rdquo;</strong> (developers) — jump straight to Daemon mode, APIs (advanced), and Security. That trio is the developer guide.</li>
              </Bullets>
              <TipBox>
                <p>
                  Zero code needed until the APIs section. Everything from Getting Started through Observability
                  is point-and-click. If you can use Trello, you can drive Conductor.
                </p>
              </TipBox>
              <DumbQuestions
                items={[
                  ['Do I need to know how LLMs work to use this?', 'No. You need to know what you want done and how to recognize whether it was done well. The agents handle the AI part — you handle the judgement part.'],
                  ['I’m a developer. Can I skip the beginner chapters?', 'Skim Core concepts first — five minutes. The API docs use those nouns constantly, and guessing what a "mode" is from endpoint names is harder than just reading the table.'],
                ]}
              />
            </Section>

            <Section
              id="help-concepts"
              title="Core concepts"
              subtitle="Eleven nouns. We'll use a film-studio analogy for all of them, because your brain remembers stories better than schemas."
            >
              <p>
                Here&apos;s the whole mental model in one go: <strong>Conductor is a film studio.</strong> Keep
                that picture in your head and every term below clicks into place.
              </p>

              <Table
                head={['Conductor says…', 'The studio version', 'One-liner']}
                rows={[
                  ['Workspace', 'The studio lot', 'Top-level container. One team or company. Everything lives inside one.'],
                  ['Project', 'A film in production', 'One product, codebase, or campaign. Own board, own cast, own keys.'],
                  ['Task', 'A scene to shoot', 'One unit of work — a card on the board, moving left to right.'],
                  ['Agent', 'A crew member', 'A configured worker: name, specialty, toolkit, badge.'],
                  ['Mode', 'The hat they’re wearing today', 'ANALYZE, DEVELOP, REVIEW… same person, different job, different permissions.'],
                  ['Chain', 'The shooting schedule', 'Ordered steps: who does what, in what order, with which approvals.'],
                  ['Skill', 'The studio handbook', 'Reusable know-how any crew member can pull off the shelf mid-scene.'],
                  ['Runtime', 'The camera equipment', 'The credentialed line to an AI provider. No equipment, no footage.'],
                  ['MCP connection', 'Props & special effects', 'External tools agents can use during a scene — files, tickets, browsers.'],
                  ['Artifact', 'The footage', 'Files an agent produced. Stored with the task, reviewable any time.'],
                  ['Activity', 'The production log', 'Who did what, when. Your audit trail when the director asks questions.'],
                ]}
              />

              <H3>The four that matter most (read these twice)</H3>

              <p>
                <strong>Task.</strong> A card on the board. It moves through states — <Term>BACKLOG</Term>,
                <Term>IN_PROGRESS</Term>, <Term>WAITING</Term>, <Term>REVIEW</Term>, <Term>DONE</Term> — as agents
                and humans act on it. Title, optional description, priority, optional agent. That&apos;s it.
              </p>

              <p>
                <strong>Agent.</strong> A configured worker: name, emoji, role, an AI provider (its
                <em> runtime</em>), a system prompt, and the modes it&apos;s allowed to run. Two flavours:
                <Term>HTTP</Term> (Conductor calls it) and <Term>DAEMON</Term> (it calls Conductor) — the
                difference matters later, in <Ref href="#help-agent-invocation">HTTP vs. Daemon</Ref>.
              </p>

              <p>
                <strong>Mode.</strong> The hat an agent wears <em>right now</em>. The same agent in
                <Term> ANALYZE</Term> mode can only read; in <Term>DEVELOP</Term> mode it can write. Modes change
                the prompt, the tools, and the expected output. Full story in <Ref href="#help-modes">Modes</Ref>.
              </p>

              <p>
                <strong>Chain.</strong> Steps in a row: &ldquo;analyse with Alice, then develop with Bob, then a
                human signs off.&rdquo; Save one as a template, reuse it forever. This is where Conductor earns
                its keep.
              </p>

              <RememberBox>
                <p>
                  Don&apos;t memorize this section. Skim it, move on, and come back when a term trips you —
                  the glossary at the bottom of this page has every word too. Repetition beats cramming.
                </p>
              </RememberBox>
            </Section>

            <Section
              id="help-quickstart"
              title="10-minute quick start"
              subtitle="Zero to 'an agent just did a thing' in seven steps. Set a timer — seriously, racing the clock makes it stick."
            >
              <PlainEnglish>
                <p>
                  The recipe: sign in &rarr; make a project &rarr; plug in an AI provider &rarr; hire one agent
                  &rarr; write one task &rarr; hand it over &rarr; watch. Each step is one screen.
                </p>
              </PlainEnglish>
              <Steps>
                <Step title="Sign in to the admin panel.">
                  {' '}Open Conductor in your browser, click <em>Sign in</em> in the top bar, and enter the admin password.
                  (If this is a fresh install, the password is set during <Term>db:push</Term> — check the
                  installation notes.)
                </Step>
                <Step title="Create your first project.">
                  {' '}Click <em>+ New Project</em> in the header. Give it a name and a colour. Tick &ldquo;Provision
                  starter agents&rdquo; if you want a ready-made set; untick it if you&apos;ll build your own.
                </Step>
                <Step title="Add or confirm a runtime.">
                  {' '}Open <em>Settings &rarr; Runtimes</em>. If none exist, add one: pick a provider (Anthropic,
                  OpenAI, …) and enter the <em>name</em> of the env var that holds your API key on the server
                  (e.g. <code>ANTHROPIC_API_KEY</code>). Your agents will use this to reach a model.
                </Step>
                <Step title="Create an agent.">
                  {' '}<em>Settings &rarr; Agents &rarr; + New Agent</em>. Name it, pick an emoji, choose the runtime
                  from step 3, and assign one or more modes (at least <Term>DEVELOP</Term>). Leave invocation mode
                  on <Term>HTTP</Term> for the first one.
                </Step>
                <Step title="Drop a task on the board.">
                  {' '}On the board, click the <em>+</em> on the <Term>BACKLOG</Term> column. Title:
                  &ldquo;Smoke test — say hello&rdquo;. Description: anything. Save.
                </Step>
                <Step title="Assign the task to your agent.">
                  {' '}Open the task, assign it to the agent you created, and set mode to <Term>DEVELOP</Term>.
                </Step>
                <Step title="Watch it work.">
                  {' '}The task card moves to <Term>IN_PROGRESS</Term>, and you&apos;ll see activity flow in the
                  task drawer. When the agent finishes, it lands in <Term>REVIEW</Term> or <Term>DONE</Term>
                  depending on whether the step was marked &ldquo;requires review&rdquo;.
                </Step>
              </Steps>

              <WatchIt>
                <p>
                  Card not moving? Don&apos;t panic — check the <Term>Live</Term> badge in the top bar first. If it
                  says <Term>Offline</Term>, the board just isn&apos;t updating in real time (dispatch still works);
                  refresh after a few seconds. Still parked in <Term>BACKLOG</Term> after a minute? That&apos;s a
                  five-minute fix: <Ref href="#help-trouble-agent">An agent won&apos;t claim</Ref>.
                </p>
              </WatchIt>

              <TryIt>
                <p>
                  Before moving on, do the loop ONE more time with a different prompt — maybe &ldquo;list three
                  risks in our deploy process&rdquo;. The second run takes 90 seconds and turns &ldquo;I followed
                  a tutorial&rdquo; into &ldquo;I know how this works&rdquo;. That&apos;s the whole trick of
                  learning this stuff.
                </p>
              </TryIt>
            </Section>

            <Section
              id="help-first-project"
              title="Your first project, step by step"
              subtitle="The quick start with training wheels: every click, what you'll see, and why it matters."
            >
              <p>
                Did the quick start feel like drinking from a firehose? This is the same journey at walking pace.
                No step assumes you guessed anything. (If the quick start worked fine for you, skip ahead — really,
                go. We won&apos;t be offended.)
              </p>

              <H3>Step 1 · Sign in</H3>
              <Bullets>
                <li>Open <code>http://localhost:3000</code> (or your deployed URL).</li>
                <li>You&apos;ll see the Conductor landing page with two buttons: <em>Sign in</em> and <em>Get Started</em>. Both take you to the board, but the board won&apos;t show any destructive actions until you authenticate as admin.</li>
                <li>Click <em>Sign in</em>, paste the admin password, hit Enter. The page reloads and you&apos;re on the board.</li>
              </Bullets>

              <H3>Step 2 · Create a project</H3>
              <Bullets>
                <li>Top-right of the board, find the <em>+ New Project</em> button. Click it.</li>
                <li>The project dialog opens. Fill in:
                  <Bullets>
                    <li><strong>Name</strong> — shown in the project selector and the sidebar.</li>
                    <li><strong>Color</strong> — a small square next to the project name; pick something you&apos;ll recognise in a list of 20.</li>
                    <li><strong>Provision starter agents</strong> (checkbox) — when ticked, Conductor creates a default cast (Analyst, Developer, Reviewer) with sensible prompts, bound to your default runtime. Recommended for the first project; untick for later ones.</li>
                  </Bullets>
                </li>
                <li>Click <em>Create</em>. The project appears in the project selector and becomes active.</li>
              </Bullets>

              <H3>Step 3 · Configure a runtime</H3>
              <p>
                A runtime is <em>how</em> an agent talks to an AI model. It holds the API key and any provider-specific
                settings. You need at least one before agents can do anything.
              </p>
              <Bullets>
                <li>First, put your provider key in the server&apos;s environment: add <code>ANTHROPIC_API_KEY=sk-…</code> (or your provider&apos;s equivalent) to <code>.env</code> and restart.</li>
                <li>Click the <Kbd>⚙</Kbd> Settings icon in the top bar &rarr; <em>Runtimes</em> tab &rarr; <em>+ Add Runtime</em>.</li>
                <li>Choose an <strong>adapter</strong> (Anthropic, OpenAI, Z.ai, Google Gemini, or a custom webhook).</li>
                <li>Enter the <strong>env var name</strong> — the name, never the key itself. Conductor stores only the reference.</li>
                <li>Click <strong>discover</strong> to fetch the live model list from the provider, and pick the models agents may use.</li>
                <li>Save. The runtime appears in the agent-creation picker immediately.</li>
              </Bullets>

              <WatchIt>
                <p>
                  API keys are money — which is exactly why Conductor never stores them. The database holds the
                  env var <em>name</em>; the secret stays in your server&apos;s environment. Still: anyone with
                  admin access can trigger calls that burn your quota, so guard the admin password like the
                  keys themselves, and rotate provider keys on a schedule (just update the env var and restart).
                </p>
              </WatchIt>

              <H3>Step 4 · Create an agent</H3>
              <Bullets>
                <li><em>Settings &rarr; Agents &rarr; + New Agent</em>.</li>
                <li>Fill in the basics:
                  <Bullets>
                    <li><strong>Name</strong> — short, descriptive: <em>Alice Analyst</em>, <em>Bob Builder</em>, etc.</li>
                    <li><strong>Emoji</strong> — shown on task cards. Helps scanning at a glance.</li>
                    <li><strong>Description</strong> — one sentence. Appears in the agent picker.</li>
                    <li><strong>Role</strong> — free-text, used for grouping (<em>analyst</em>, <em>developer</em>, <em>reviewer</em>).</li>
                  </Bullets>
                </li>
                <li>Pick a <strong>runtime</strong> from the dropdown. If you only have one, it&apos;s preselected.</li>
                <li>Override the <strong>model</strong> if you want a stronger or cheaper one than the runtime default.</li>
                <li>Tick the <strong>modes</strong> this agent supports. For a first agent, tick <Term>DEVELOP</Term> and <Term>ANALYZE</Term>.</li>
                <li>Paste a <strong>system prompt</strong>. Keep it short and pointed — describe the agent&apos;s voice and any hard rules.</li>
                <li>Leave <strong>Invocation mode</strong> on <Term>HTTP</Term> unless you&apos;re running a daemon (see <Ref href="#help-daemon">Daemon mode</Ref>).</li>
                <li>Set <strong>Max concurrent</strong> to 1 to start; raise it once you know the agent handles parallel work.</li>
                <li>Save. The agent appears in the agents list with a grey dot (idle).</li>
              </Bullets>

              <H3>Step 5 · Create a task and dispatch it</H3>
              <Bullets>
                <li>Close settings, go back to the board.</li>
                <li>On the <Term>BACKLOG</Term> column, click the <em>+</em> at the top. A task drawer slides in from the right.</li>
                <li>Title, description, priority, optional tags. Save &mdash; the card appears in <Term>BACKLOG</Term>.</li>
                <li>Click the card. In the drawer, find the <em>Assign</em> section: pick your agent, pick mode <Term>DEVELOP</Term>.</li>
                <li>Click <em>Dispatch</em>. The card moves to <Term>IN_PROGRESS</Term>; the agent status dot goes green; activity rows start to stream into the drawer.</li>
                <li>When the agent finishes, the task moves to <Term>REVIEW</Term> (if the step requires approval) or <Term>DONE</Term>.</li>
              </Bullets>

              <Callout tone="neon" title="🎉 You're live — and here's the secret">
                <p>
                  That was the full loop: project &rarr; runtime &rarr; agent &rarr; task &rarr; work &rarr; review
                  &rarr; done. Here&apos;s the secret nobody tells you: <strong>there is nothing else.</strong>{' '}
                  Every remaining chapter is either <em>this loop at scale</em> (chains instead of single
                  dispatches, daemons instead of HTTP, five agents instead of one) or <em>binoculars for
                  watching the loop run</em> (observability, activity log, step output viewer). You already know
                  Conductor. The rest is details.
                </p>
              </Callout>
            </Section>

            <Section id="help-anatomy" title="Anatomy of the app">
              <p>
                A map of the UI so the rest of this guide can reference things by name.
              </p>

              <H3>Top bar</H3>
              <Bullets>
                <li><strong>Logo &amp; workspace switcher</strong> — click the logo to return to the landing page; click the workspace name to switch workspaces.</li>
                <li><strong>Live badge</strong> — <Term>Live</Term> (green) when the WebSocket is connected, <Term>Offline</Term> (grey) when it isn&apos;t, <Term>Realtime Off</Term> when not configured.</li>
                <li><strong>Project selector</strong> — dropdown on the right (if you have more than one project).</li>
                <li><strong>Agent status pills</strong> — up to five emoji bubbles with a green dot under each active agent. Click to open the full agent popover.</li>
                <li><strong>+ New Project</strong>, <Kbd>⚙</Kbd> Settings, <Kbd>📖</Kbd> Skills, <Kbd>📈</Kbd> Runtime, <Kbd>?</Kbd> Help, <Kbd>⎋</Kbd> Logout — icon buttons on the far right.</li>
              </Bullets>

              <H3>Left sidebar (desktop)</H3>
              <p>
                Holds the project list, quick filters, and (on mobile) the hamburger menu. The version badge (<em>Conductor v0.3</em>) sits at the bottom.
              </p>

              <H3>Main area</H3>
              <p>
                Shows one of: the board (default), the runtime dashboard, the skills library, or this help page.
                Views are exclusive — switching one closes the others.
              </p>

              <H3>Task drawer</H3>
              <p>
                Slides in from the right when you click a card. Shows full details: description, activity,
                assigned agent, current mode, steps, artifacts, and action buttons.
              </p>
            </Section>

            {/* ════════════════════════════════════════════════════════════════
                THE BOARD
               ════════════════════════════════════════════════════════════════ */}

            <Section
              id="help-board"
              title="The Kanban board"
              subtitle="Four columns, drag-and-drop, live updates. If you've used Trello, you've done the tutorial already."
            >
              <p>
                Good news: the board is deliberately boring. Cards flow left to right. Columns are states. The only
                new idea is <em>who</em> moves the cards — here, it&apos;s mostly the agents, and your job is to
                watch the river flow and fish out anything that snags.
              </p>

              <PlainEnglish>
                <p>
                  Left side = &ldquo;to do&rdquo;. Middle = &ldquo;robots working&rdquo;. Right side = &ldquo;needs
                  your eyeballs, then done&rdquo;. When in doubt, look right — that&apos;s where you&apos;re needed.
                </p>
              </PlainEnglish>

              <H3>The four columns</H3>
              <Table
                head={['Column', 'Meaning', 'Who moves cards here']}
                rows={[
                  [<Term key="a">BACKLOG</Term>, 'Unassigned or assigned-but-not-started work.', 'Humans (drag, dispatch, or automation poller).'],
                  [<Term key="b">IN_PROGRESS</Term>, 'An agent is actively working on it.', 'Automatic when an agent claims the task.'],
                  [<Term key="c">REVIEW</Term>, 'Work is done but needs human approval.', 'Automatic when a step marked &ldquo;requires review&rdquo; completes.'],
                  [<Term key="d">DONE</Term>, 'Approved or auto-approved. Finished.', 'A human approver or the chain itself.'],
                ]}
              />

              <H3>A hidden fifth state: WAITING</H3>
              <p>
                <Term>WAITING</Term> doesn&apos;t have its own column on the main board. It means the task is paused
                for an external event — a webhook callback, a scheduled delay, or a slow tool call. Tasks in
                <Term>WAITING</Term> stay in their original column (usually <Term>IN_PROGRESS</Term>) with a small
                hourglass badge. They resume automatically when the event arrives.
              </p>

              <H3>Drag-and-drop</H3>
              <Bullets>
                <li>Grab a card by the handle on its left edge and drop it in another column to override the state machine. Useful for pulling work back out of <Term>DONE</Term> by mistake, or parking a stuck task.</li>
                <li>Dropping into <Term>REVIEW</Term> does <em>not</em> trigger an approval request by itself — it just parks the task. To actually run a reviewable step, dispatch it through an agent with a review gate.</li>
              </Bullets>

              <H3>Filtering and sorting</H3>
              <Bullets>
                <li>The search box above the columns filters cards by title, description, or agent.</li>
                <li>Click an agent avatar in the top bar to filter by that agent.</li>
                <li>Click a priority badge on a card to filter by priority.</li>
              </Bullets>
            </Section>

            <Section id="help-tasks" title="Creating and editing tasks">
              <H3>Create</H3>
              <Steps>
                <Step title="Open the column.">{' '}Click the <em>+</em> at the top of the <Term>BACKLOG</Term> column.</Step>
                <Step title="Fill the form.">{' '}Title is required; everything else is optional.</Step>
                <Step title="Pick a priority.">{' '}<Term>LOW</Term>, <Term>MEDIUM</Term>, <Term>HIGH</Term>, <Term>URGENT</Term>. Affects sort order and any priority-based dispatch rules.</Step>
                <Step title="(Optional) Assign an agent.">{' '}If you pick one here, the task dispatches straight to <Term>IN_PROGRESS</Term> on save instead of sitting in <Term>BACKLOG</Term>.</Step>
                <Step title="(Optional) Pick a chain.">{' '}Pick a <Ref href="#help-chains">chain</Ref> template if you want a multi-step workflow instead of a single step.</Step>
                <Step title="Save.">{' '}Card appears instantly on the board.</Step>
              </Steps>

              <H3>Edit</H3>
              <p>
                Click the card. The drawer opens. Every field is editable in place. Hit <Kbd>⌘ / Ctrl</Kbd>+<Kbd>Enter</Kbd>
                to save a text field without moving off it, or click outside to blur-save.
              </p>

              <H3>Delete</H3>
              <p>
                Hover a card and hit the trash icon. You&apos;ll get a confirmation, and then a safety net:
                deleted tasks go into a <strong>30-day grace period</strong> — restore them any time from
                <em> Settings &rarr; Activity &rarr; Recently Deleted Tasks</em>. After 30 days the purge is
                permanent (steps, executions, and artifacts included).
              </p>
            </Section>

            <Section id="help-task-states" title="Task state machine">
              <p>
                Every transition is validated server-side. If an agent tries a transition that isn&apos;t allowed,
                the API returns <code>409 Conflict</code> and the card doesn&apos;t move.
              </p>

              <H3>Allowed transitions</H3>
              <Table
                head={['From', 'To', 'Who can trigger', 'Typical cause']}
                rows={[
                  [<Term key="a">BACKLOG</Term>, <Term key="b">IN_PROGRESS</Term>, 'Agent or human', 'Agent claims the task.'],
                  [<Term key="c">IN_PROGRESS</Term>, <Term key="d">WAITING</Term>, 'Agent', 'Step waits for a webhook or scheduled wake.'],
                  [<Term key="e">WAITING</Term>, <Term key="f">IN_PROGRESS</Term>, 'System', 'External event arrives.'],
                  [<Term key="g">IN_PROGRESS</Term>, <Term key="h">REVIEW</Term>, 'Agent', 'A reviewable step completes.'],
                  [<Term key="i">IN_PROGRESS</Term>, <Term key="j">DONE</Term>, 'Agent', 'A non-reviewable step completes.'],
                  [<Term key="k">REVIEW</Term>, <Term key="l">DONE</Term>, 'Human', 'Approver clicks Approve.'],
                  [<Term key="m">REVIEW</Term>, <Term key="n">IN_PROGRESS</Term>, 'Human', 'Approver rejects with feedback; agent retries.'],
                  ['Any', <Term key="o">BACKLOG</Term>, 'Human', 'Manual override via drag.'],
                ]}
              />

              <WatchIt>
                <p>
                  The board will let you drag <Term>DONE</Term> back to <Term>IN_PROGRESS</Term> (re-queues the
                  task — handy). It will <em>refuse</em> <Term>BACKLOG</Term> straight to <Term>DONE</Term>,
                  because closing a task no agent ever touched is almost always a misclick. Genuinely need it?
                  <em> Drawer &rarr; ⋯ menu &rarr; Force close</em> — which makes you leave a reason in the
                  activity log, because Future You will ask.
                </p>
              </WatchIt>

              <DumbQuestions
                items={[
                  ['Why can’t I just edit the state in a dropdown like other tools?', 'Because every transition is validated server-side and recorded — the board is a window onto a state machine, not a free-form spreadsheet. That discipline is what makes the audit trail trustworthy.'],
                  ['What happens if an agent and I move a card at the same time?', 'The server picks a winner (first write), the loser gets a 409, and the board re-syncs in a second. Nobody loses data; worst case you re-drag.'],
                ]}
              />
            </Section>

            <Section id="help-task-drawer" title="Task detail drawer">
              <p>
                The drawer is where you spend most of your time once a task is flowing. It has five tabs.
              </p>

              <Bullets>
                <li><strong>Details</strong> — title, description, priority, tags, assignee, mode, chain.</li>
                <li><strong>Activity</strong> — the full timeline for this task: created, claimed, started, tool calls, completed, approved. Scrolls with new events in real time.</li>
                <li><strong>Steps</strong> — if the task is running a chain, each step is listed with its status, duration, and a link to the step output viewer.</li>
                <li><strong>Artifacts</strong> — files produced by the agent. Previewable inline for text, code, and images; downloadable for everything else.</li>
                <li><strong>Danger zone</strong> — force-close, delete, export.</li>
              </Bullets>

              <H3>Inline actions</H3>
              <Bullets>
                <li><em>Approve</em> / <em>Reject</em> — only visible when the task is in <Term>REVIEW</Term>. Rejecting opens a feedback box.</li>
                <li><em>Re-dispatch</em> — re-runs the current step with the same agent.</li>
                <li><em>Reassign</em> — hands the task to a different agent mid-flight. Useful when an agent is stuck.</li>
                <li><em>Cancel</em> — stops the current step. The task returns to <Term>BACKLOG</Term>.</li>
              </Bullets>
            </Section>

            <Section
              id="help-review-gates"
              title="Human review gates"
              subtitle="The single most important feature in this app. Yes, really."
            >
              <p>
                Think of a review gate as the <strong>&ldquo;sign here before we ship it&rdquo;</strong> line on a
                delivery form. Any step in a chain can be marked <em>requires human approval</em>. When that step
                finishes, the task parks in <Term>REVIEW</Term>, the chain holds its breath, and <em>nothing</em>
                downstream runs until a human clicks <em>Approve</em> or <em>Reject</em>.
              </p>

              <PlainEnglish>
                <p>
                  Gates are how you let agents be fast without letting them be reckless. The agent does the work;
                  you keep the veto.
                </p>
              </PlainEnglish>

              <H3>When to gate</H3>
              <Bullets>
                <li><strong>Before anything irreversible</strong> — pushing to production, sending an email, posting to a public channel, deleting data.</li>
                <li><strong>At expensive hand-offs</strong> — after a costly reasoning step whose output will drive a lot of downstream work.</li>
                <li><strong>For quality control during rollout</strong> — gate everything while you learn an agent&apos;s failure modes; remove gates as trust builds.</li>
              </Bullets>

              <H3>What a reviewer sees</H3>
              <Bullets>
                <li>The task card is in <Term>REVIEW</Term> with an orange ring and a small gavel icon.</li>
                <li>The drawer opens on the <em>Steps</em> tab, with the current step expanded: input prompt, agent output, tool calls, any artifacts.</li>
                <li>Two buttons: <em>Approve</em> (continues the chain) and <em>Reject</em> (opens a feedback box).</li>
              </Bullets>

              <H3>Rejection with feedback</H3>
              <p>
                When a reviewer rejects, they can type a short message. Conductor pushes that feedback back into the
                agent&apos;s next attempt as a structured <code>&lt;human-feedback&gt;</code> block at the top of the
                prompt. The task re-enters <Term>IN_PROGRESS</Term> and the step runs again.
              </p>

              <WatchIt>
                <p>
                  Reject-retry-reject-retry is a money fire. Each step has a <em>max attempts</em> counter
                  (default 3) so an agent can&apos;t loop on your dime forever. After the limit, the task parks in
                  <Term> REVIEW</Term> with a red &ldquo;exhausted&rdquo; banner and waits for a human. Tune it in
                  <em> Settings &rarr; Modes &rarr; [mode] &rarr; Max attempts</em>.
                </p>
              </WatchIt>

              <TipBox>
                <p>
                  Rollout recipe that works: gate <em>everything</em> for the first week. You&apos;ll learn each
                  agent&apos;s failure modes fast and cheap. Then remove gates one at a time, starting with the
                  steps that bored you most. Trust is earned per-step, not granted per-agent.
                </p>
              </TipBox>
            </Section>

            {/* ════════════════════════════════════════════════════════════════
                AGENTS
               ════════════════════════════════════════════════════════════════ */}

            <Section
              id="help-agents"
              title="What is an agent?"
              subtitle="A configured worker that can claim tasks, run modes, and call tools."
            >
              <p>
                Surprise: an agent is not a program. It&apos;s an <strong>employee file</strong>. Name, photo
                (okay, emoji), job description, toolkit, security badge. The actual work happens either in
                Conductor&apos;s own worker pool (HTTP agents) or in a process you run yourself (daemon agents) —
                but the <em>file</em> is what tells Conductor who this worker is and what they&apos;re allowed
                to do.
              </p>

              <PlainEnglish>
                <p>
                  &ldquo;Alice is a developer. She thinks with Claude Sonnet. She&apos;s allowed to analyse and
                  write code, but not to deploy. Here&apos;s her badge.&rdquo; — that&apos;s an agent record,
                  in five sentences.
                </p>
              </PlainEnglish>

              <RememberBox>
                <p>
                  The record describes the job. The <strong>runtime</strong> is the toolkit. The <strong>system
                  prompt</strong> is the onboarding doc. The <strong>API key</strong> is the badge. Lose the badge
                  → rotate it; change the job → edit the record. The employee never gets confused, because the
                  employee IS the file.
                </p>
              </RememberBox>

              <H3>What an agent record holds</H3>
              <Bullets>
                <li><strong>Identity</strong> — name, emoji, colour, description.</li>
                <li><strong>Role</strong> — free-text tag for grouping (analyst, developer, reviewer). Used by dispatch rules and the agents view.</li>
                <li><strong>Runtime &amp; model</strong> — which provider and model this agent uses when it thinks.</li>
                <li><strong>Supported modes</strong> — the subset of modes the agent is allowed to run. Tasks dispatched in an unsupported mode are refused.</li>
                <li><strong>Mode instructions</strong> — optional per-mode system prompt overrides.</li>
                <li><strong>Invocation mode</strong> — <Term>HTTP</Term> or <Term>DAEMON</Term>. See <Ref href="#help-agent-invocation">HTTP vs. Daemon</Ref>.</li>
                <li><strong>Max concurrent</strong> — how many tasks this agent can work on at once.</li>
                <li><strong>Active flag</strong> — a kill switch. Inactive agents don&apos;t claim new tasks.</li>
                <li><strong>API key</strong> — secret the agent uses to authenticate to Conductor.</li>
              </Bullets>
            </Section>

            <Section id="help-agent-create" title="Creating an agent">
              <p>
                Agents are created per-project from <em>Settings &rarr; Agents &rarr; + New Agent</em>. The creation
                modal is a guided flow: identity &rarr; capabilities &rarr; review.
              </p>

              <H3>The creation wizard</H3>
              <Steps>
                <Step title="Identity.">
                  {' '}Name, emoji, colour, role, description. The name shows on task cards and in the agents list;
                  the emoji is the visual fingerprint. Colour is used for sparkline accents and avatar rings.
                </Step>
                <Step title="Capabilities.">
                  {' '}Pick the runtime, override the model if you want, tick supported modes, set max concurrent.
                  If you plan to use this agent in daemon mode, toggle <em>Invocation mode</em> to <Term>DAEMON</Term>
                  — the UI then hides HTTP-only fields (like webhook URL).
                </Step>
                <Step title="Prompts.">
                  {' '}Base system prompt on the left (applies to every mode), per-mode overrides on the right. A
                  good base prompt is two or three sentences: the agent&apos;s voice, its domain, any hard rules
                  (&ldquo;never push to main&rdquo;, &ldquo;always cite sources&rdquo;).
                </Step>
                <Step title="Review.">
                  {' '}Shows the full record. Click <em>Create</em>. Conductor generates an API key — copy it now,
                  it isn&apos;t shown again.
                </Step>
              </Steps>

              <WatchIt>
                <p>
                  The #1 rookie mistake: a 2,000-word system prompt. You pay for those tokens on <em>every single
                  call</em>, and smaller models drown in them. Keep the base prompt to 2–3 sentences (voice +
                  hard rules), push mode-specific guidance into per-mode overrides, and park reusable playbooks
                  in the <Ref href="#help-skills">skills library</Ref> where agents fetch them only when needed.
                  Shorter prompt, sharper agent, smaller bill.
                </p>
              </WatchIt>

              <DumbQuestions
                items={[
                  ['Can two agents share one runtime?', 'Absolutely — runtimes are meant to be shared. Twenty agents can all think with the same Anthropic key. What they can’t share is an API key (their badge): one badge per agent, or your audit trail turns to soup.'],
                  ['What makes a good agent name?', 'Whatever helps you scan the board at 9am. "Alice Analyst 🔬" beats "agent-prod-2". The emoji shows up on every task card — pick distinct ones.'],
                ]}
              />
            </Section>

            <Section id="help-agent-roles" title="Agent roles">
              <p>
                Role is a free-text tag, not an enum. Conductor doesn&apos;t enforce what a role means — it&apos;s
                there so you can group and filter. That said, the following conventions are baked into the starter
                agents and into most chain templates:
              </p>

              <Table
                head={['Role', 'Typical mode', 'What it does']}
                rows={[
                  [<Term key="a">analyst</Term>, 'ANALYZE', 'Reads a brief, produces a plan or summary. No side-effects.'],
                  [<Term key="b">verifier</Term>, 'VERIFY', 'Checks a plan or diff against acceptance criteria. Returns pass/fail with rationale.'],
                  [<Term key="c">developer</Term>, 'DEVELOP', 'Produces code, docs, or artifacts. May call tools via MCP.'],
                  [<Term key="d">reviewer</Term>, 'REVIEW', 'Reads a developer output and either approves or returns feedback.'],
                  [<Term key="e">writer</Term>, 'DRAFT', 'Produces prose — release notes, emails, reports.'],
                ]}
              />

              <p>
                Use whatever roles you like. A common pattern for larger teams: split <Term>developer</Term> into
                <Term>frontend-dev</Term> / <Term>backend-dev</Term> / <Term>infra-dev</Term> and route tasks with
                <Ref href="#help-automation-dispatch">auto-dispatch rules</Ref>.
              </p>
            </Section>

            <Section
              id="help-agent-invocation"
              title="HTTP vs. Daemon"
              subtitle="Two ways an agent can run work. Pick per-agent."
            >
              <p>
                Conductor supports two invocation models. Both can coexist in the same project.
              </p>

              <Table
                head={['Dimension', 'HTTP', 'Daemon']}
                rows={[
                  ['Who starts the call', 'Conductor', 'The agent (long-lived)'],
                  ['Where the agent runs', 'Stateless function / webhook endpoint', 'A process you run on a machine'],
                  ['Connection', 'Per-request HTTPS POST', 'Persistent WebSocket + heartbeat'],
                  ['Best for', 'Stateless API-backed agents, serverless', 'CLI-backed agents (Claude Code, Aider), GPU workers'],
                  ['Startup cost', 'None', 'Process boot time, but paid once per run'],
                  ['Failure handling', 'Retry the request', 'Terminal fail drives the task state machine'],
                ]}
              />

              <H3>When to pick HTTP</H3>
              <Bullets>
                <li>Your agent is a simple function: prompt in, completion out. No filesystem, no long context.</li>
                <li>You want to run the agent on serverless (Lambda, Cloud Run).</li>
                <li>You don&apos;t want to manage processes.</li>
              </Bullets>

              <H3>When to pick Daemon</H3>
              <Bullets>
                <li>Your agent is a CLI (Claude Code, OpenCode, Aider, codex): start once, reuse.</li>
                <li>Your agent needs a warm local model, a GPU, or a checked-out repository.</li>
                <li>You want the agent to pull work on its own schedule instead of being pushed.</li>
              </Bullets>

              <Callout tone="purple" title="Mix them freely">
                <p>
                  A typical production setup: HTTP agents for analyse/verify/review (cheap, stateless, fast) and
                  daemon agents for develop (stateful, CLI-backed, local). Conductor picks the right runner
                  automatically based on each agent&apos;s invocation mode.
                </p>
              </Callout>
            </Section>

            <Section id="help-agent-keys" title="Agent API keys">
              <p>
                Every agent has its own secret key. The key authenticates the agent to Conductor&apos;s APIs.
                Keys are minted on creation and can be rotated from <em>Settings &rarr; Agents &rarr; [agent] &rarr; Rotate key</em>.
              </p>

              <H3>Key lifecycle</H3>
              <Bullets>
                <li><strong>Minted</strong> on agent creation. Shown once — copy it immediately.</li>
                <li><strong>Previewed</strong> as <code>ab_1234…abcd</code> in the agents list for identification.</li>
                <li><strong>Rotated</strong> on demand. Rotation invalidates the old key atomically; there is no overlap window.</li>
                <li><strong>Revoked</strong> when you deactivate the agent. The key is wiped.</li>
              </Bullets>

              <H3>How to use a key</H3>
              <p>
                Every agent-side request carries <code>Authorization: Bearer &lt;agent-key&gt;</code>. Conductor looks
                up the agent by the key and uses the agent&apos;s record (runtime, modes, permissions) to authorise
                the request. See <Ref href="#help-api-auth">Authentication</Ref>.
              </p>

              <Callout tone="amber" title="Don't share keys between agents">
                <p>
                  Each agent gets its own key so activity is attributable. Reusing one key across agents
                  (&ldquo;one key per team&rdquo;) breaks the activity log and defeats per-agent rate limits.
                  If you want a human-readable service account, create an agent called <em>svc-scripts</em> and
                  use its key.
                </p>
              </Callout>
            </Section>

            <Section id="help-agent-status" title="Active, idle, and muted">
              <H3>The status dot</H3>
              <Bullets>
                <li><strong>Green</strong> — active and currently working on at least one task.</li>
                <li><strong>Emerald with pulse</strong> — active, idle, ready to claim.</li>
                <li><strong>Grey</strong> — inactive. Won&apos;t claim work.</li>
                <li><strong>Amber</strong> — active but rate-limited or over max-concurrent.</li>
                <li><strong>Red</strong> — daemon hasn&apos;t heartbeat within timeout; assumed crashed.</li>
              </Bullets>

              <H3>The active flag</H3>
              <p>
                <em>Settings &rarr; Agents &rarr; [agent] &rarr; Active</em> toggle. Turning this off is the cleanest
                way to pause an agent without losing its config or key. Useful during deploys, quota exhaustion,
                or when you&apos;re testing a replacement.
              </p>

              <H3>Deactivating versus deleting</H3>
              <p>
                Deleting an agent is permanent. Any task that mentions the agent by ID will still render, but the
                agent itself vanishes from pickers. Deactivate first, let anything in flight finish, <em>then</em>
                delete.
              </p>
            </Section>

            {/* ════════════════════════════════════════════════════════════════
                MODES
               ════════════════════════════════════════════════════════════════ */}

            <Section
              id="help-modes"
              title="What are modes?"
              subtitle="Different hats for the same head. The hat decides what the agent may touch."
            >
              <p>
                Picture a surgeon. In the operating room: scalpel privileges. On the review board: read-the-chart
                privileges, <em>no scalpel</em>. Same person, same training — different hat, different permissions.
                That&apos;s a mode. <Term>DEVELOP</Term> mode can touch the filesystem; <Term>REVIEW</Term> mode
                can only read. Same agent, different hat.
              </p>

              <PlainEnglish>
                <p>
                  A mode answers three questions at once: <em>what should the agent focus on</em> (the prompt),
                  <em> what is it allowed to use</em> (the tools), and <em>what should come back</em> (the output
                  shape). Change the mode, change all three.
                </p>
              </PlainEnglish>

              <p>
                When Conductor dispatches a task, it combines three prompt layers:
              </p>
              <Steps>
                <Step title="System prompt.">{' '}The agent&apos;s base prompt (from <em>Settings &rarr; Agents</em>).</Step>
                <Step title="Mode instructions.">{' '}The agent&apos;s per-mode overrides, then the workspace-default mode instructions from <em>Settings &rarr; Modes</em>.</Step>
                <Step title="Task prompt.">{' '}The task&apos;s own description, plus any step-level input from a chain.</Step>
              </Steps>
              <p>
                Tool permissions are evaluated the same way — a tool is allowed only if both the mode and the agent
                allow it.
              </p>
            </Section>

            <Section id="help-modes-builtin" title="Built-in modes">
              <Table
                head={['Mode', 'Purpose', 'Tool access', 'Output shape']}
                rows={[
                  [<Term key="a">ANALYZE</Term>, 'Understand and plan.', 'Read-only (search, fetch, grep).', 'Markdown plan with explicit steps.'],
                  [<Term key="b">VERIFY</Term>, 'Check work against criteria.', 'Read-only + test runner.', 'Structured pass/fail with rationale.'],
                  [<Term key="c">DEVELOP</Term>, 'Produce the artifact.', 'Read + write + tool execution.', 'Diff, files, or code block.'],
                  [<Term key="d">REVIEW</Term>, 'Human-style review.', 'Read-only.', 'Structured feedback (approve/reject + comments).'],
                  [<Term key="e">DRAFT</Term>, 'Write prose.', 'Read-only.', 'Markdown or plain text.'],
                ]}
              />

              <H3>Why bother? (a fair question)</H3>
              <p>
                Because a raw LLM is an enthusiastic intern with no job description. Ask it to &ldquo;fix this
                bug&rdquo; and it&apos;ll plan a little, code a little, grade its own homework, and declare victory
                — all in one breath. Modes split that mush into stages with contracts. Three practical wins:
              </p>
              <Bullets>
                <li><strong>Predictable outputs</strong> — each mode has a stable output contract the next step can parse.</li>
                <li><strong>Scoped permissions</strong> — read-only modes can&apos;t write; writing modes can&apos;t push.</li>
                <li><strong>Auditability</strong> — every step in the activity log has a mode, so you can see the <em>why</em> as well as the <em>what</em>.</li>
              </Bullets>
            </Section>

            <Section id="help-modes-custom" title="Custom modes">
              <p>
                Built-in modes are just defaults. Create your own in <em>Settings &rarr; Modes &rarr; + New Mode</em>.
                A custom mode has:
              </p>
              <Bullets>
                <li>A name and a short description.</li>
                <li>Default instructions (markdown) that are merged into the prompt.</li>
                <li>A tool allowlist (see <Ref href="#help-modes-permissions">Scoped tool permissions</Ref>).</li>
                <li>A max-attempts number (how many times a chain step in this mode can retry before parking).</li>
                <li>An output-format hint (<em>markdown</em>, <em>json</em>, <em>diff</em>, <em>plain</em>).</li>
              </Bullets>

              <p>
                Examples of custom modes teams have built:
              </p>
              <Bullets>
                <li><Term>TRIAGE</Term> — reads a bug report and classifies severity and component.</li>
                <li><Term>SUMMARIZE</Term> — condenses a long thread into a 5-bullet TL;DR.</li>
                <li><Term>DEPLOY</Term> — kicks off a deploy pipeline and posts the result. Requires a specific MCP tool allowlist.</li>
                <li><Term>ONCALL</Term> — triages an alert, proposes a fix, gates on human approval before acting.</li>
              </Bullets>
            </Section>

            <Section id="help-modes-permissions" title="Scoped tool permissions">
              <p>
                Every agent has a set of tools it <em>could</em> call (its runtime + any MCP connections it can see).
                Modes narrow that further. The effective permission is the intersection.
              </p>

              <H3>Allowlist model</H3>
              <p>
                Modes are deny-by-default. If the allowlist is empty, the agent has no tools. Common allowlist
                patterns:
              </p>
              <Bullets>
                <li><strong>Read-only</strong> — <code>fs.read</code>, <code>http.get</code>, <code>search.*</code>.</li>
                <li><strong>Author</strong> — read-only plus <code>fs.write</code>.</li>
                <li><strong>Test-runner</strong> — read-only plus <code>test.run</code>.</li>
                <li><strong>Deploy</strong> — strict allowlist with the specific tool, e.g. <code>deploy.staging</code>.</li>
              </Bullets>

              <H3>Wildcards</H3>
              <p>
                Tool names are hierarchical (<code>namespace.name</code>). The allowlist supports <code>*</code> and
                <code>namespace.*</code>. For example, <code>github.*</code> lets the agent call any GitHub MCP tool
                but nothing else.
              </p>

              <Callout tone="amber" title="Validate before shipping">
                <p>
                  Mode allowlists are enforced at dispatch time. A mode that allows nothing will make every
                  tool call fail with a visible error — which is what you want. Test a new mode with a safe
                  task first, then roll it out.
                </p>
              </Callout>
            </Section>

            {/* ════════════════════════════════════════════════════════════════
                CHAINS & WORKFLOWS
               ════════════════════════════════════════════════════════════════ */}

            <Section
              id="help-chains"
              title="What is a chain?"
              subtitle="A relay race for agents. Each runner carries the baton one leg, then hands it off."
            >
              <p>
                A chain is a relay race: an ordered list of steps, each pairing a <em>mode</em> with an
                <em> agent</em>, plus rules for what happens on success or failure. The baton — each step&apos;s
                output — gets handed to the next runner automatically. Single dispatches are fine for smoke
                tests, but any task worth automating is usually a relay:
                <em> analyse &rarr; develop &rarr; review</em>.
              </p>

              <PlainEnglish>
                <p>
                  &ldquo;First Alice figures out what to do. Then Bob does it. Then Carol checks it. Then I sign
                  off.&rdquo; Write that sentence down and you&apos;ve designed a chain — the builder is just
                  that sentence as a form.
                </p>
              </PlainEnglish>

              <TipBox>
                <p>
                  Memorize ONE chain and you&apos;re covered for most of real life:
                  <Term> ANALYZE</Term> &rarr; <Term>DEVELOP</Term> &rarr; <Term>REVIEW</Term> with a human gate
                  on the last step. Three steps, one checkpoint. Start every new workflow as a copy of this and
                  mutate from there.
                </p>
              </TipBox>

              <H3>Chain anatomy</H3>
              <Bullets>
                <li><strong>Steps</strong> — ordered list. Each has a mode, an agent (or a role), an input template, and a success handler.</li>
                <li><strong>Input template</strong> — how the step builds its prompt from the task and previous steps&apos; outputs. Uses Mustache-style <code>{`{{ prev.output }}`}</code> and <code>{`{{ task.description }}`}</code>.</li>
                <li><strong>Success handler</strong> — what happens when the step succeeds: advance, branch, or finish.</li>
                <li><strong>Failure handler</strong> — what happens on error: retry with backoff, hand off to another agent, or park.</li>
                <li><strong>Gate</strong> — optional human approval before the step&apos;s output is passed downstream.</li>
              </Bullets>
            </Section>

            <Section id="help-chain-templates" title="Chain templates">
              <p>
                A chain template is a saved, reusable chain definition. Stored per-project; shareable across
                projects via the template library.
              </p>

              <H3>Starter templates</H3>
              <Bullets>
                <li><strong>Bug fix</strong> — analyse issue &rarr; reproduce &rarr; develop fix &rarr; run tests &rarr; review.</li>
                <li><strong>Investigation</strong> — analyse &rarr; gather &rarr; summarise &rarr; draft report.</li>
                <li><strong>Documentation</strong> — analyse codebase &rarr; draft docs &rarr; review.</li>
                <li><strong>Release notes</strong> — scan git log &rarr; draft notes &rarr; review &rarr; publish.</li>
                <li><strong>Oncall triage</strong> — classify alert &rarr; propose fix &rarr; gate on human &rarr; apply.</li>
              </Bullets>

              <p>
                These are copied into your project when you first create it (if you tick the starter-agents option)
                and can be freely edited. The originals stay read-only in the template library.
              </p>
            </Section>

            <Section id="help-chain-builder" title="Using the chain builder">
              <p>
                The chain builder is the visual editor for chains. Open it from <em>Settings &rarr; Templates &rarr;
                + New Chain</em> or from the task drawer (<em>Attach chain &rarr; Build new</em>).
              </p>

              <H3>The canvas</H3>
              <Bullets>
                <li>Left panel: step list. Drag to reorder, click to edit.</li>
                <li>Right panel: step detail — mode, agent (or role), input template, gate toggle, max attempts.</li>
                <li>Top: save, validate, test-run against a dry-run fixture.</li>
              </Bullets>

              <H3>Validation on save</H3>
              <p>
                Saving validates the chain end-to-end:
              </p>
              <Bullets>
                <li>Every step has a mode and at least one eligible agent (or a role that resolves to one).</li>
                <li>Input templates reference only variables that exist at that point in the chain.</li>
                <li>Every branch reaches a terminal state (no orphaned steps).</li>
                <li>No step&apos;s allowlist is inconsistent with its agent&apos;s supported modes.</li>
              </Bullets>
              <p>
                Failed validation blocks save and shows a red banner with the offending step highlighted. This is
                intentional — half-baked chains fail noisily at run time in ways that are hard to debug.
              </p>

              <H3>Dry-run</H3>
              <p>
                Click <em>Test run</em> to execute the chain against a synthetic task without dispatching any agent.
                Each step&apos;s prompt is rendered but not sent. Good for catching template errors.
              </p>
            </Section>

            <Section id="help-workflow-editor" title="Workflow editor">
              <p>
                For chains that branch (A &rarr; B if success, A &rarr; C if failure; A &rarr; B &amp; D in parallel),
                the linear chain builder isn&apos;t enough. The workflow editor is a node-graph view of the same
                model, optimised for non-linear flows.
              </p>

              <H3>When to use which</H3>
              <Bullets>
                <li><strong>Chain builder</strong> — linear workflows with at most one gate. 80% of cases.</li>
                <li><strong>Workflow editor</strong> — branching, fan-out/fan-in, loops, sub-workflows.</li>
              </Bullets>
              <p>
                Both save to the same underlying format, so you can start in the chain builder and upgrade to the
                workflow editor when you need to branch.
              </p>

              <H3>Workflow primitives</H3>
              <Bullets>
                <li><strong>Step</strong> — a single mode + agent invocation.</li>
                <li><strong>Parallel</strong> — run multiple steps concurrently, wait for all to finish.</li>
                <li><strong>Gate</strong> — a human-approval checkpoint.</li>
                <li><strong>Wait</strong> — a scheduled or event-driven pause (useful for deferring to the next business day, or waiting for a webhook).</li>
                <li><strong>Sub-workflow</strong> — embed another chain as a single node. Reusable across workflows.</li>
              </Bullets>
            </Section>

            <Section id="help-handoffs" title="Automatic handoffs">
              <p>
                Handoffs are what makes a chain feel fluid. When step N finishes, Conductor automatically:
              </p>
              <Steps>
                <Step title="Renders step N+1's input template.">{' '}Substituting <code>{`{{ prev.output }}`}</code> with step N&apos;s result.</Step>
                <Step title="Resolves the agent for step N+1.">{' '}Either the configured agent, or the best-match for the role.</Step>
                <Step title="Dispatches to that agent in the configured mode.">{' '}The task moves back to <Term>IN_PROGRESS</Term> with the new mode.</Step>
                <Step title="Logs a handoff event.">{' '}Visible in the task&apos;s activity tab.</Step>
              </Steps>

              <H3>Role-based handoffs</H3>
              <p>
                If step N+1 is bound to a role (<Term>developer</Term>) instead of a specific agent, Conductor picks
                the best-match agent at dispatch time. &ldquo;Best match&rdquo; = active + supports the mode +
                fewest tasks currently in flight. Ties are broken by the agent&apos;s priority score.
              </p>

              <Callout tone="teal" title="Role-based is usually the right call">
                <p>
                  Binding to a role rather than a specific agent lets you add or retire agents without touching
                  the chain. Only bind to a specific agent when you genuinely need that one (<em>only Alice has
                  the credentials to deploy</em>).
                </p>
              </Callout>
            </Section>

            {/* ════════════════════════════════════════════════════════════════
                SKILLS LIBRARY
               ════════════════════════════════════════════════════════════════ */}

            <Section
              id="help-skills"
              title="Skills overview"
              subtitle="Reusable prompt fragments and playbooks, shared across agents and projects."
            >
              <p>
                A <strong>skill</strong> in Conductor is a named, versioned piece of knowledge an agent can pull in
                when it needs it — a prompt fragment, a checklist, a code snippet, a company-specific playbook.
                The skills library is per-workspace, so every project in a workspace shares the same pool.
              </p>

              <PlainEnglish>
                <p>
                  Skills are the office bookshelf. You don&apos;t make every employee carry the entire company
                  handbook to every meeting — you put it on a shelf and they grab the chapter they need. Same
                  deal: stuffing playbooks into every system prompt costs tokens on every call; skills get
                  fetched only when relevant.
                </p>
              </PlainEnglish>

              <H3>What&apos;s in a skill</H3>
              <Bullets>
                <li><strong>Title</strong> — short, imperative: &ldquo;Write a PR description&rdquo;, &ldquo;Reproduce a Rails test failure&rdquo;.</li>
                <li><strong>Tags</strong> — free-form labels for filtering (<code>testing</code>, <code>security</code>, <code>onboarding</code>).</li>
                <li><strong>Body</strong> — markdown. Usually 5-50 lines: the actual how-to.</li>
                <li><strong>Example inputs/outputs</strong> — optional, one or two shots the retriever surfaces alongside the body.</li>
                <li><strong>Embedding</strong> — computed on save (when pgvector is available), used for semantic search.</li>
              </Bullets>
            </Section>

            <Section id="help-skills-search" title="Semantic search">
              <p>
                When an agent starts a step, Conductor runs a similarity search over the skills library using the
                task description as the query. The top-N hits (configurable, default 5) are injected into the
                agent&apos;s prompt as a <code>&lt;skills&gt;</code> block.
              </p>

              <H3>How the search works</H3>
              <Bullets>
                <li><strong>Embedding-based</strong> when PostgreSQL with <code>pgvector</code> is configured. Skills are embedded on save; queries are embedded on dispatch.</li>
                <li><strong>Tag-based fallback</strong> when running on SQLite. The chain&apos;s mode and the task&apos;s tags drive a keyword match instead.</li>
              </Bullets>

              <H3>Tuning retrieval</H3>
              <Bullets>
                <li><em>Settings &rarr; Templates &rarr; Skills retrieval</em> controls how many skills are injected per dispatch and the minimum similarity threshold.</li>
                <li>Pin a skill to &ldquo;always inject&rdquo; if it&apos;s a global rule that every agent should always see (keep these short — they&apos;re paid for on every call).</li>
              </Bullets>
            </Section>

            <Section id="help-skills-create" title="Creating skills">
              <p>
                Open the Skills library from the <Kbd>📖</Kbd> icon in the top bar. Click <em>+ New Skill</em>.
              </p>

              <H3>A good skill is short and specific</H3>
              <Bullets>
                <li><strong>Short</strong> — a skill that needs 200 lines of prose probably wants to be 3 separate skills.</li>
                <li><strong>Imperative</strong> — &ldquo;When asked to write a test, follow these steps…&rdquo; beats &ldquo;Testing philosophy is…&rdquo;.</li>
                <li><strong>Anchored by example</strong> — one concrete example beats five abstract points.</li>
                <li><strong>Dated</strong> — add a version marker if the process might change, so stale skills are easy to spot.</li>
              </Bullets>

              <Callout tone="amber" title="Don't duplicate the system prompt">
                <p>
                  If something belongs in every agent&apos;s system prompt, put it there. Skills are for knowledge
                  that&apos;s <em>sometimes</em> useful — if every dispatch retrieves the same skill, you&apos;re
                  paying embedding costs for no benefit.
                </p>
              </Callout>
            </Section>

            {/* ════════════════════════════════════════════════════════════════
                MCP CONNECTIONS
               ════════════════════════════════════════════════════════════════ */}

            <Section
              id="help-mcp"
              title="What is MCP?"
              subtitle="Model Context Protocol — a standard for letting LLMs call external tools."
            >
              <p>
                MCP (Model Context Protocol) is an open standard for connecting LLMs to tools. An MCP server
                exposes a set of named functions with typed parameters; an MCP client (Conductor, in this case)
                discovers them, passes their schemas to the model, and executes the ones the model calls.
              </p>

              <PlainEnglish>
                <p>
                  MCP is USB-C for AI tools. Before USB-C: every gadget had its own cable, every drawer was
                  chaos. Before MCP: every agent needed its own integration with every tool. Now you write one
                  MCP server and every MCP-speaking client — Conductor, Claude Desktop, whatever comes next —
                  can plug into it.
                </p>
              </PlainEnglish>

              <WatchIt>
                <p>
                  Tool <em>results</em> come from outside your control — a compromised or mischievous MCP server
                  could embed &ldquo;ignore your instructions&rdquo; text in a response. Conductor scans every
                  tool result for prompt-injection patterns and quarantines flagged content in an explicit
                  data-only wrapper before the model sees it again. You&apos;ll find the warnings in the activity
                  log when it happens.
                </p>
              </WatchIt>

              <H3>Why Conductor uses it</H3>
              <Bullets>
                <li><strong>Standardisation</strong> — an MCP server you wire up for Claude Desktop works here too.</li>
                <li><strong>Per-project scoping</strong> — projects pick which MCP connections their agents can see.</li>
                <li><strong>Auditable tool calls</strong> — every MCP tool invocation shows up in the activity log with args and result.</li>
              </Bullets>

              <H3>Common MCP servers</H3>
              <Bullets>
                <li><strong>Filesystem</strong> — read/write files in a sandboxed directory.</li>
                <li><strong>GitHub</strong> — list issues, open PRs, comment, review.</li>
                <li><strong>Jira / Linear / Atlassian</strong> — read and update tickets.</li>
                <li><strong>Playwright / browser</strong> — click, type, screenshot, scrape.</li>
                <li><strong>Slack</strong> — post to channels, read threads.</li>
                <li><strong>Custom</strong> — your own internal APIs, wrapped in an MCP server.</li>
              </Bullets>
            </Section>

            <Section id="help-mcp-connect" title="Connecting a server">
              <p>
                Connections are per-project. <em>Settings &rarr; MCP &rarr; + Add Connection</em>.
              </p>

              <Steps>
                <Step title="Pick transport.">
                  {' '}<Term>stdio</Term> (Conductor launches the server as a subprocess),
                  <Term>http</Term> (Conductor calls a hosted MCP endpoint), or
                  <Term>ws</Term> (WebSocket).
                </Step>
                <Step title="Fill in connection details.">
                  {' '}For <Term>stdio</Term>: command and args. For <Term>http</Term>: URL + bearer token. For <Term>ws</Term>: URL + headers.
                </Step>
                <Step title="Test the connection.">
                  {' '}Click <em>Discover tools</em>. Conductor pings the server, lists the tools it exposes, and shows their schemas.
                </Step>
                <Step title="Pick an allowlist (optional).">
                  {' '}By default every tool is exposed to agents. Tick individual tools to narrow — useful for
                  &ldquo;I want this MCP server but not the delete operation&rdquo;.
                </Step>
                <Step title="Save.">{' '}Connection appears with a green dot when alive.</Step>
              </Steps>

              <Callout tone="amber" title="Network-facing servers need a token">
                <p>
                  If you&apos;re connecting to an HTTP or WebSocket MCP server, use a token. Conductor stores it
                  encrypted, but the server itself is the last line of defence — assume anything exposed on the
                  network will be probed.
                </p>
              </Callout>
            </Section>

            <Section id="help-mcp-tools" title="Tool execution loop">
              <p>
                When an agent is running a step and the model decides to call a tool, Conductor runs this loop:
              </p>
              <Steps>
                <Step title="Receive the tool call.">{' '}The model emits a tool-call message with name and arguments.</Step>
                <Step title="Check permissions.">{' '}The tool must be in the mode&apos;s allowlist AND the agent&apos;s allowlist AND the project&apos;s MCP connection allowlist. Any layer can veto.</Step>
                <Step title="Invoke the tool.">{' '}Conductor forwards the call to the MCP server, waits for the result.</Step>
                <Step title="Log the call.">{' '}Name, args, result (or error), duration, cost — all written to the activity log and the step&apos;s output viewer.</Step>
                <Step title="Return the result to the model.">{' '}The model sees the result, decides whether to call another tool or finish.</Step>
              </Steps>

              <H3>Limits that stop runaway loops</H3>
              <Bullets>
                <li><strong>Max tool calls per step</strong> — default 20. Configurable per mode.</li>
                <li><strong>Max step duration</strong> — default 10 minutes. After that, the step fails with a timeout.</li>
                <li><strong>Max cost per step</strong> — optional dollar ceiling. If provided, Conductor refuses further tool calls once the step has burnt through its budget.</li>
              </Bullets>
            </Section>

            {/* ════════════════════════════════════════════════════════════════
                RUNTIMES
               ════════════════════════════════════════════════════════════════ */}

            <Section id="help-runtimes" title="What is a runtime?">
              <p>
                A runtime is a credentialed connection to an AI provider. &ldquo;Alice talks to Claude&rdquo;
                is really &ldquo;Alice&apos;s runtime points to the Anthropic API, using this key, with this default
                model&rdquo;. Runtimes are workspace-level: once you add one, any project in the workspace can pick it.
              </p>

              <H3>Supported providers</H3>
              <Bullets>
                <li><strong>Anthropic</strong> — Claude Opus, Sonnet, Haiku.</li>
                <li><strong>OpenAI</strong> — GPT-4.x and later, plus whichever models your key can access.</li>
                <li><strong>OpenRouter</strong> — catch-all router; gives you access to a wide catalogue with one key.</li>
                <li><strong>Azure OpenAI</strong> — Microsoft&apos;s managed OpenAI deployment.</li>
                <li><strong>AWS Bedrock</strong> — Claude and others via AWS.</li>
                <li><strong>Google Vertex</strong> — Gemini models.</li>
                <li><strong>Ollama / local</strong> — pointed at a local endpoint (<code>http://localhost:11434</code> by default).</li>
                <li><strong>Generic OpenAI-compatible</strong> — for third-party inference providers that match the OpenAI API shape.</li>
              </Bullets>
            </Section>

            <Section id="help-runtimes-add" title="Adding a runtime">
              <PlainEnglish>
                <p>
                  Plot twist: you never paste an API key into Conductor. You tell it the <em>name of the
                  environment variable</em> that holds the key (e.g. <code>ANTHROPIC_API_KEY</code>) on the
                  server. The secret stays in your environment; the database only ever stores the name. This is
                  more secure than encrypted storage — there&apos;s nothing to leak.
                </p>
              </PlainEnglish>
              <Steps>
                <Step title="Set the env var on the server.">{' '}e.g. <code>ANTHROPIC_API_KEY=sk-…</code> in your <code>.env</code>, then restart.</Step>
                <Step title="Open Settings → Runtimes → + Add Runtime."></Step>
                <Step title="Pick an adapter.">{' '}Anthropic, OpenAI, Z.ai, Google Gemini, or Custom Webhook.</Step>
                <Step title="Enter the env var NAME.">{' '}The name, not the key: <code>ANTHROPIC_API_KEY</code>.</Step>
                <Step title="Discover models.">{' '}For providers that support it, click the discover button — Conductor fetches the live model list with your key so you pick from real options instead of guessing strings.</Step>
                <Step title="Save.">{' '}Runtime is immediately available in the agent creation picker.</Step>
              </Steps>
              <TipBox>
                <p>
                  The stethoscope button on each runtime fires a one-prompt connectivity test and shows the
                  latency inline; each card also shows its last-30-days usage (runs, tokens, cost).
                </p>
              </TipBox>

              <Callout tone="teal" title="Multiple runtimes per provider are fine">
                <p>
                  Add as many as you like. Common pattern: one &ldquo;prod&rdquo; runtime with a paid tier and rate
                  limits, one &ldquo;cheap&rdquo; runtime on a smaller model for high-volume low-stakes tasks
                  (classifiers, triage). Agents pick the one that fits.
                </p>
              </Callout>
            </Section>

            {/* ════════════════════════════════════════════════════════════════
                TEMPLATES
               ════════════════════════════════════════════════════════════════ */}

            <Section id="help-templates" title="Task templates">
              <p>
                A task template is a saved form for a recurring kind of task: the title pattern, the default
                description, the default chain, the default priority, and any default tags. When you dispatch
                from a template, Conductor pre-fills the task drawer so you only change what&apos;s different.
              </p>

              <H3>Creating a template</H3>
              <Bullets>
                <li><em>Settings &rarr; Templates &rarr; + New Task Template</em>.</li>
                <li>Fill in the defaults. Any field you leave blank will be prompt-for-input at dispatch time.</li>
                <li>(Optional) Attach a chain template so every task from this form runs the same workflow.</li>
                <li>Save. The template appears in the task-create dropdown on the board.</li>
              </Bullets>

              <H3>When to template</H3>
              <Bullets>
                <li>Anything you create more than twice. Weekly reports, PR reviews, bug triage, oncall reports.</li>
                <li>Anything with non-obvious defaults. Templates are the lowest-friction way to encode &ldquo;the right way to open this kind of task&rdquo;.</li>
              </Bullets>
            </Section>

            <Section id="help-chain-templates-ref" title="Chain templates reference">
              <p>
                Chain templates live alongside task templates in <em>Settings &rarr; Templates</em>. A chain template
                is the <em>workflow</em>; a task template is the <em>form</em> for creating a task. They pair up:
                a task template usually attaches a chain template.
              </p>

              <H3>Managing chain templates</H3>
              <Bullets>
                <li><em>Duplicate</em> — clone an existing template to start from something that works.</li>
                <li><em>Version</em> — Conductor tracks edits; you can roll back to any prior version.</li>
                <li><em>Share to workspace</em> — templates are per-project by default; promote to workspace to make them available everywhere.</li>
                <li><em>Archive</em> — hide from pickers without deleting. Inactive templates stop appearing in auto-dispatch rules.</li>
              </Bullets>
            </Section>

            {/* ════════════════════════════════════════════════════════════════
                AUTOMATION
               ════════════════════════════════════════════════════════════════ */}

            <Section
              id="help-automation"
              title="Automation overview"
              subtitle="Project-wide rules that poll the board and dispatch pending work."
            >
              <p>
                Automation runs inside Conductor: a per-project scheduler polls the step queue on an interval
                (default 10s) and dispatches any step that&apos;s active and has an eligible agent. Configured
                per project under <em>Settings &rarr; Automation</em>.
              </p>

              <H3>Modes</H3>
              <Bullets>
                <li><strong>Manual</strong> (default) — no polling; you drag tasks to <Term>IN_PROGRESS</Term> yourself.</li>
                <li><strong>Startup</strong> — poll starts when the server boots; continues until server restart.</li>
                <li><strong>Always</strong> — same as startup plus immediate start when the mode is changed.</li>
                <li><strong>Scheduled</strong> — poll only during a day/time window (e.g. business hours).</li>
              </Bullets>

              <H3>What automation can do</H3>
              <Bullets>
                <li>Auto-assign tasks to an agent based on tags, priority, or title pattern.</li>
                <li>Auto-dispatch tasks as soon as they enter <Term>BACKLOG</Term>, instead of waiting for a human.</li>
                <li>Auto-archive <Term>DONE</Term> tasks after N days.</li>
                <li>Auto-escalate <Term>REVIEW</Term> tasks that have been waiting for approval too long.</li>
                <li>Auto-retry failed steps up to a ceiling.</li>
              </Bullets>
            </Section>

            <Section id="help-automation-dispatch" title="Configuring automation">
              <p>
                In <em>Settings &rarr; Automation</em> you pick a mode, set the poll interval, and (for scheduled
                mode) a weekly time window. There are no per-task rules — the scheduler simply picks up any
                active step whose agent is eligible and dispatches it.
              </p>

              <H3>Fields</H3>
              <Bullets>
                <li><strong>Mode</strong> — manual / always / startup / scheduled (see overview).</li>
                <li><strong>Poll interval</strong> — 3s, 5s, 10s (default), 30s, 1m, 5m. Shorter = more responsive, more DB queries.</li>
                <li><strong>Schedule window</strong> (scheduled mode only) — day-of-week + time range. A window that wraps across the weekend (Fri 18:00 → Mon 08:00) is supported.</li>
                <li><strong>Running toggle</strong> — shows whether the poller is currently active. The Play/Stop buttons start or stop it manually without changing the mode.</li>
              </Bullets>

              <Callout tone="amber" title="Timezone">
                <p>
                  Schedule windows evaluate against the server&apos;s local time, not the viewer&apos;s. If the
                  server and your team are in different timezones, pick your window with the server&apos;s clock
                  in mind — a DST transition can silently shift it by an hour.
                </p>
              </Callout>

              <Callout tone="amber" title="Test before you ship">
                <p>
                  Automation rules fire quietly. A broken rule that dispatches every task to the wrong agent will
                  eat through your token budget fast. Use the <em>Dry run against recent tasks</em> button — it
                  shows which of the last 100 tasks would have matched.
                </p>
              </Callout>
            </Section>

            {/* ════════════════════════════════════════════════════════════════
                TRIGGERS & REACTIONS
               ════════════════════════════════════════════════════════════════ */}

            <Section
              id="help-integrations"
              title="Triggers & Reactions overview"
              subtitle="Connect AgentBoard events to the outside world."
            >
              <PlainEnglish>
                <p>
                  Triggers and Reactions are &ldquo;when this, do that&rdquo; — the same recipe as IFTTT or
                  Zapier, living inside your project. <strong>When</strong> a chain completes / a step fails /
                  Sentry coughs up a new error, <strong>do</strong> post to Slack, file a Jira ticket, call a
                  webhook, send an email. In that order, as many as you like.
                </p>
              </PlainEnglish>

              <p>
                Formally: a <strong>Trigger</strong> watches for an event (internal, or polled from Sentry) and
                fires its ordered list of <strong>Reactions</strong> when every filter matches.
              </p>
              <p>
                Configure everything in <em>Settings &rarr; Integrations</em>. No code required — each Trigger
                and its Reactions are created and edited entirely in the UI.
              </p>

              <H3>How it works end-to-end</H3>
              <Bullets>
                <li>An event fires inside Conductor (e.g. a chain completes) or a Sentry poll returns new issues.</li>
                <li>Conductor checks whether any enabled Trigger for this project matches the event type and passes all its filters.</li>
                <li>If matched, the Trigger&apos;s Reactions run <strong>in order</strong> (lowest <code>order</code> first).</li>
                <li>Each Reaction&apos;s config is rendered through Mustache before execution — it can reference event fields and the outputs of previous Reactions.</li>
                <li>If any Reaction fails, execution stops. The failure is written to the Reaction record and, if the Trigger was associated with a task, surfaced as a banner toast in the UI.</li>
              </Bullets>
            </Section>

            <Section id="help-integrations-triggers" title="Triggers">
              <p>
                A Trigger is a project-scoped rule that decides <em>when</em> to act. There are two types:
              </p>

              <H3>Event triggers</H3>
              <p>
                Fire when a specific internal event is broadcast in the project. Supported event types:
              </p>
              <Bullets>
                <li><strong>chain-completed</strong> — a chain ran to its final step successfully.</li>
                <li><strong>step-failed</strong> — an agent step reached its retry ceiling and gave up.</li>
                <li><strong>task-created</strong> — a new task was added to the board.</li>
                <li><strong>step-reviewed</strong> — a human approved or rejected a review gate.</li>
              </Bullets>

              <H3>Sentry poll triggers</H3>
              <p>
                Poll the Sentry API every 60 seconds for new issues in a project. Each new issue fires the
                Trigger&apos;s Reactions with the issue fields available as Mustache variables (<code>{'{{title}}'}</code>,
                {' '}<code>{'{{level}}'}</code>, <code>{'{{url}}'}</code>, etc.).
              </p>
              <p>
                Sentry poll config fields:
              </p>
              <Bullets>
                <li><strong>apiTokenEnvVar</strong> — name of the env var holding your Sentry auth token.</li>
                <li><strong>orgSlug</strong> — your Sentry organisation slug.</li>
                <li><strong>projectSlug</strong> — the Sentry project slug to poll.</li>
                <li><strong>environment</strong> (optional) — filter to a specific Sentry environment.</li>
              </Bullets>

              <H3>Filters</H3>
              <p>
                Event triggers can have one or more filters. All filters must pass for the Trigger to fire (AND logic).
                Each filter targets a dot-path field in the event payload and tests it against a value:
              </p>
              <Bullets>
                <li><code>equals</code> / <code>not_equals</code> — exact string match.</li>
                <li><code>contains</code> / <code>not_contains</code> — substring match.</li>
                <li><code>matches</code> — JavaScript regex match (e.g. <code>^sentry-</code>).</li>
              </Bullets>

              <Callout tone="cobalt" title="Enable/disable">
                <p>
                  Each Trigger has an enable/disable toggle. Disabled Triggers are skipped by the event evaluator
                  and the Sentry poller — useful for temporarily pausing a rule without deleting it.
                </p>
              </Callout>
            </Section>

            <Section id="help-integrations-reactions" title="Reactions">
              <p>
                A Reaction is a typed action that executes when its parent Trigger fires. Reactions run
                sequentially in ascending <code>order</code> number. Four types are supported:
              </p>

              <H3>post:slack</H3>
              <p>Posts a message to a Slack incoming webhook.</p>
              <Bullets>
                <li><strong>webhookEnvVar</strong> — env var name holding the Slack webhook URL.</li>
                <li><strong>text</strong> — message text (supports Mustache templates).</li>
                <li><strong>blocks</strong> (optional) — Slack Block Kit array for rich formatting.</li>
              </Bullets>

              <H3>post:http</H3>
              <p>Makes an outbound HTTPS request. Only <code>https://</code> URLs are allowed.</p>
              <Bullets>
                <li><strong>url</strong> — the target URL (must be https).</li>
                <li><strong>method</strong> (optional, default <code>POST</code>) — HTTP verb.</li>
                <li><strong>headers</strong> (optional) — additional request headers object.</li>
                <li><strong>body</strong> (optional) — request body, JSON-serialised.</li>
              </Bullets>

              <H3>create:jira</H3>
              <p>Creates a Jira issue via the Jira REST API v3.</p>
              <Bullets>
                <li><strong>domainEnvVar</strong> — env var for your Jira domain (e.g. <code>https://acme.atlassian.net</code>).</li>
                <li><strong>emailEnvVar</strong> — env var for the Jira account email.</li>
                <li><strong>apiTokenEnvVar</strong> — env var for the Jira API token.</li>
                <li><strong>projectKey</strong> — Jira project key (e.g. <code>PROJ</code>).</li>
                <li><strong>summary</strong> — issue title (supports Mustache).</li>
                <li><strong>issueType</strong> (optional, default <code>Task</code>) — issue type name.</li>
                <li><strong>description</strong> (optional) — issue body text.</li>
              </Bullets>
              <p>
                The output of a successful <code>create:jira</code> reaction exposes <code>issueKey</code>,
                {' '}<code>issueId</code>, and <code>issueUrl</code> to subsequent reactions via Mustache.
              </p>

              <H3>send:email</H3>
              <p>Sends an email via SMTP (nodemailer).</p>
              <Bullets>
                <li><strong>smtpHostEnvVar</strong> — env var for the SMTP host.</li>
                <li><strong>smtpPortEnvVar</strong> (optional, default 587) — env var for the SMTP port.</li>
                <li><strong>smtpUserEnvVar</strong> / <strong>smtpPassEnvVar</strong> (optional) — SMTP credentials.</li>
                <li><strong>from</strong>, <strong>to</strong>, <strong>subject</strong>, <strong>text</strong> — standard email fields.</li>
                <li><strong>html</strong> (optional) — HTML body.</li>
              </Bullets>

              <Callout tone="cobalt" title="Credentials stay in env vars">
                <p>
                  All secrets (tokens, passwords, webhook URLs) are referenced by env var <em>name</em>, not stored
                  as values. The reaction config stores the variable name; Conductor resolves the actual value at
                  runtime from the server&apos;s environment. Never paste a token directly into the config JSON.
                </p>
              </Callout>
            </Section>

            <Section id="help-integrations-templates" title="Mustache templates">
              <p>
                Any string value in a Reaction&apos;s config can be a Mustache template. The template is rendered
                at execution time with a context object containing:
              </p>
              <Bullets>
                <li><code>{'{{event.*}}'}</code> — fields from the triggering event payload (e.g. <code>{'{{event.taskId}}'}</code>, <code>{'{{event.title}}'}</code>).</li>
                <li><code>{'{{reactions.<name>.*}}'}</code> — the output of a previously executed reaction, keyed by its sanitised name. For example, if reaction 0 is named &ldquo;Create Jira&rdquo; and creates an issue, reaction 1 can reference <code>{'{{reactions.create_jira.issueKey}}'}</code>.</li>
              </Bullets>
              <p>
                The sanitised name is computed as: lowercase, non-alphanumeric characters replaced with underscores, leading/trailing underscores stripped, prefixed with the reaction&apos;s <code>order</code> number to avoid collisions (e.g. order 0, name &ldquo;Notify Slack&rdquo; → <code>0_notify_slack</code>).
              </p>

              <Callout tone="amber" title="Arrays are not recursed">
                <p>
                  Mustache rendering recurses into nested objects but not into arrays. If your config has an array
                  of strings with template tokens, those tokens will not be rendered. Use a flat string field instead
                  and construct arrays in a <code>post:http</code> body if needed.
                </p>
              </Callout>
            </Section>

            <Section id="help-integrations-failures" title="Failure handling">
              <p>
                Reaction execution is fire-and-forget from the caller&apos;s perspective — it does not block the
                event that triggered it. When a Reaction fails:
              </p>
              <Bullets>
                <li>Execution of the remaining Reactions in the chain stops immediately.</li>
                <li>The <code>consecutiveFailures</code> counter on the Reaction is incremented and the error message stored.</li>
                <li>After <strong>5 consecutive failures</strong>, the Reaction is automatically disabled. Re-enable it from the Integrations UI once the underlying issue is fixed.</li>
                <li>If the Trigger was associated with a board task, a <strong>destructive toast banner</strong> appears in the UI with the Reaction name and error message.</li>
              </Bullets>

              <H3>Test-firing a Trigger</H3>
              <p>
                Each Trigger card in <em>Settings &rarr; Integrations</em> has a <strong>Test</strong> button.
                It fires the Trigger&apos;s enabled Reactions immediately with an empty payload. Reactions will fail
                if the required env vars are not set — that&apos;s expected and harmless. Use it to verify your
                config structure before waiting for a real event.
              </p>

              <Callout tone="amber" title="Sentry poll triggers and the failure toast">
                <p>
                  The failure toast only appears when the Trigger has a <code>taskId</code> — which event triggers
                  do but Sentry poll triggers do not. Sentry poll failures are written to the Reaction record and
                  visible in the Integrations UI, but do not generate a toast.
                </p>
              </Callout>
            </Section>

            {/* ════════════════════════════════════════════════════════════════
                OBSERVABILITY
               ════════════════════════════════════════════════════════════════ */}

            <Section
              id="help-obs-runtime"
              title="Runtime dashboard"
              subtitle="Mission control. When something feels slow or weird, you look here first."
            >
              <p>
                Open it from the <Kbd>📈</Kbd> icon in the top bar. Think of it as the dashboard of your car:
                you don&apos;t stare at it while everything&apos;s fine, but when the engine makes <em>that
                noise</em>, this is where the gauges are. Three tabs: <strong>Daemons</strong> (worker
                processes), <strong>Hosts</strong> (the machines they run on), and <strong>Sessions</strong>
                (live terminal sessions with output you can actually read — watch-only, by design).
              </p>

              <H3>What it shows</H3>
              <Bullets>
                <li><strong>Active agents</strong> — a row per online agent with a live task count and last-seen time.</li>
                <li><strong>Queue depth</strong> — pending steps waiting to be claimed. Spikes mean capacity is short.</li>
                <li><strong>Throughput</strong> — steps completed per minute, over the last 15/60 minutes.</li>
                <li><strong>Failure rate</strong> — % of steps that ended in error. Rising = investigate.</li>
                <li><strong>P95 step duration</strong> — ninety-fifth percentile of completed step time. Catches tail latencies that averages hide.</li>
              </Bullets>

              <H3>Reading the signals</H3>
              <Bullets>
                <li><strong>Queue depth climbing + throughput flat</strong> — agents are saturated. Add capacity or raise max-concurrent.</li>
                <li><strong>Queue depth flat + throughput dropping</strong> — a dependency slowed down. Check MCP connections and runtime latencies.</li>
                <li><strong>Failure rate spiking</strong> — click through to failed steps and look at the error. Usually a token-limit hit, a rate-limit, or a schema-mismatched tool call.</li>
              </Bullets>
            </Section>

            <Section id="help-obs-agent" title="Agent activity dashboard">
              <p>
                Per-agent view. Open from <em>Settings &rarr; Agents &rarr; [agent] &rarr; Activity</em>. Drills
                into one agent&apos;s history.
              </p>

              <Bullets>
                <li><strong>Tasks claimed / completed / failed</strong> — counts over a selectable window.</li>
                <li><strong>Claim rate</strong> — how often the agent picks up new work when offered. Low claim rate with non-empty queue = the agent is rejecting tasks (usually mode mismatch).</li>
                <li><strong>Average step duration</strong> — per mode.</li>
                <li><strong>Cost</strong> — if runtime cost tracking is enabled, total spend for this agent.</li>
              </Bullets>
            </Section>

            <Section id="help-obs-overview" title="Observability dashboard">
              <p>
                Cross-project view aimed at whoever operates Conductor for the team. KPIs a non-technical lead can
                skim:
              </p>

              <Bullets>
                <li><strong>Tasks completed / week</strong> — the throughput measure.</li>
                <li><strong>Average cycle time</strong> — from <Term>BACKLOG</Term> to <Term>DONE</Term>, per project.</li>
                <li><strong>Review gate wait time</strong> — how long tasks sit in <Term>REVIEW</Term> before a human acts. The leading indicator of reviewer fatigue.</li>
                <li><strong>Rejection rate</strong> — share of gated steps rejected. Rising = agent quality is slipping or criteria changed.</li>
                <li><strong>Cost per completed task</strong> — if runtime cost tracking is on.</li>
              </Bullets>
            </Section>

            <Section id="help-obs-daemon-log" title="Daemon log viewer">
              <p>
                For agents running in daemon mode, Conductor streams stdout and stderr from the daemon process
                over its WebSocket back into the browser. Open <em>Runtime dashboard &rarr; [daemon agent] &rarr;
                Logs</em>.
              </p>

              <H3>What you can do</H3>
              <Bullets>
                <li><strong>Follow</strong> — the default. New lines scroll in as they arrive.</li>
                <li><strong>Pause</strong> — freeze the view while you read.</li>
                <li><strong>Filter</strong> — by level (info/warn/error) or by regex.</li>
                <li><strong>Download</strong> — dump the current buffer to a file. The buffer is capped (default 5,000 lines) to protect the browser.</li>
              </Bullets>
            </Section>

            <Section id="help-obs-step-output" title="Step output viewer">
              <p>
                The deepest view into a single step. Open by clicking the step row in the task drawer&apos;s
                <em> Steps</em> tab.
              </p>

              <H3>What&apos;s on the pane</H3>
              <Bullets>
                <li><strong>Rendered prompt</strong> — the exact system + mode + task prompt the model saw, with any injected skills.</li>
                <li><strong>Model response</strong> — verbatim completion.</li>
                <li><strong>Tool calls</strong> — name, args, result (or error), duration. Expandable per call.</li>
                <li><strong>Artifacts produced</strong> — inline preview for text, code, images; download link for everything else.</li>
                <li><strong>Cost &amp; token usage</strong> — per-attempt breakdown if runtime supports it.</li>
                <li><strong>Raw JSON</strong> — the full step record, for debugging.</li>
              </Bullets>

              <Callout tone="teal" title="This is the first place to look when a step misbehaves">
                <p>
                  Ninety percent of &ldquo;why did the agent do <em>that</em>&rdquo; debugging happens in the step
                  output viewer. The rendered prompt almost always contains the answer.
                </p>
              </Callout>
            </Section>

            <Section id="help-obs-attempts" title="Attempt comparison">
              <p>
                When a step is retried — after a failure, after a human rejection, after a chain re-run — each
                attempt is recorded independently. The attempt comparison viewer puts two or more side-by-side.
              </p>

              <H3>Use it to</H3>
              <Bullets>
                <li>See what the reviewer&apos;s feedback changed (before vs. after rejection).</li>
                <li>Diff prompts when an agent starts failing a task it used to pass (did a skill change?).</li>
                <li>Pick which attempt produced the right answer and promote it to the step&apos;s canonical output.</li>
              </Bullets>

              <H3>How to open</H3>
              <p>
                <em>Task drawer &rarr; Steps tab &rarr; [step] &rarr; Compare attempts</em>. Tick two or more, click
                <em> Compare</em>. Differences are highlighted inline.
              </p>
            </Section>

            <Section id="help-obs-artifacts" title="Artifacts">
              <p>
                An <strong>artifact</strong> is a file produced by an agent: a diff, a document, a screenshot, a
                CSV, a zip. Artifacts live on the task; each step that produced any is listed in the drawer&apos;s
                <em> Artifacts</em> tab.
              </p>

              <H3>Supported previews</H3>
              <Bullets>
                <li>Markdown, plain text, code — rendered inline with syntax highlighting.</li>
                <li>Diffs (<code>.diff</code>, <code>.patch</code>) — unified-diff view with +/- colouring.</li>
                <li>Images (PNG, JPG, SVG) — rendered.</li>
                <li>JSON / YAML — pretty-printed and collapsible.</li>
                <li>Anything else — download link.</li>
              </Bullets>

              <H3>Retention</H3>
              <p>
                Artifacts are kept for the life of the task plus 30 days. After deletion, only the metadata
                (name, size, SHA) remains in the activity log. Configure retention in
                <em> Settings &rarr; General &rarr; Retention</em>.
              </p>
            </Section>

            {/* ════════════════════════════════════════════════════════════════
                SETTINGS TOUR
               ════════════════════════════════════════════════════════════════ */}

            <Section
              id="help-settings-general"
              title="Settings · General"
              subtitle="The grand tour of the gear icon starts here. One short stop per tab — bring comfortable shoes."
            >
              <TipBox>
                <p>
                  The Settings dialog is tabbed: each section below matches one tab. You&apos;ll visit Runtimes
                  and Agents constantly, Activity when debugging, and the rest about once a quarter. Skim
                  accordingly.
                </p>
              </TipBox>
              <Bullets>
                <li><strong>Project name &amp; description</strong> — editable right here; <em>Save changes</em> updates the selector and sidebar immediately.</li>
                <li><strong>Task defaults</strong> — a default step mode (an agent-assigned task with no steps auto-creates one step in this mode and dispatches) and a default chain template (prefills the step builder on new tasks — visible and editable, a suggestion not a surprise).</li>
                <li><strong>Artifact retention</strong> — how long DONE tasks keep their artifacts (7 days to forever). Purges run lazily in the background.</li>
                <li><strong>Tasks summary</strong> — live card counts per column.</li>
                <li><strong>Danger zone</strong> — delete the project by typing its name. Removes agents, tasks, steps, artifacts, and history. There is no undo, which is why there&apos;s typing.</li>
              </Bullets>
              <TipBox>
                <p>
                  Set the default step mode and suddenly &ldquo;assign an agent&rdquo; on a plain task actually
                  runs it — no chain-building required for simple one-shot work. Park a task in
                  <Term> BACKLOG</Term> explicitly if you want assignment <em>without</em> dispatch.
                </p>
              </TipBox>
            </Section>

            <Section id="help-settings-agents" title="Settings · Agents">
              <p>
                Manage the cast of agents for this project. Covered in detail in
                <Ref href="#help-agent-create"> Creating an agent</Ref> and <Ref href="#help-agent-status">Active,
                idle, and muted</Ref>.
              </p>
              <Bullets>
                <li>One card per agent with emoji, name, Active badge, and description.</li>
                <li>Per-row buttons: <strong>activity</strong> (expands an inline dashboard), <strong>edit</strong>, <strong>delete</strong> (with confirmation — deletion also wipes the agent&apos;s key).</li>
                <li>Key rotation lives on the <em>API Keys</em> tab, next to the keys themselves.</li>
                <li><em>+ Add Agent</em> opens the creation modal — disabled (with a pointer) until you&apos;ve added a runtime.</li>
              </Bullets>
              <p className="text-sm">
                The <strong>duplicate</strong> button clones a working agent&apos;s full configuration with a
                fresh API key (shown once) — the copy starts <em>inactive</em> so you can review it before it
                claims work.
              </p>
            </Section>

            <Section id="help-settings-api" title="Settings · API keys">
              <H3>Project API key</H3>
              <p>
                A single key used by external callers to talk to this project&apos;s REST API without impersonating
                a specific agent. Useful for scripts and bridges. Rotation invalidates all old tokens atomically.
              </p>

              <H3>Agent keys</H3>
              <p>
                The table shows a preview of every agent&apos;s key (<code>ab_1234…abcd</code>) and a rotate
                button. Full keys are shown exactly once, at rotation time.
              </p>

              <H3>Integration keys (scoped)</H3>
              <p>
                For CI pipelines, webhooks, and dashboards — credentials that aren&apos;t an agent and
                aren&apos;t you. Issue with a label and explicit scopes: <code>read</code> pulls activity,
                analytics, hosts, and sessions; <code>write</code> creates tasks. The raw key is shown once;
                revoked keys stay listed for audit.
              </p>

              <H3>Admin session</H3>
              <p>
                A session cookie issued when you sign in. Password and session length are managed on the
                <em> Security</em> tab; changing the password signs everyone out immediately.
              </p>
            </Section>

            <Section id="help-settings-activity" title="Settings · Activity">
              <p>
                The full activity log for the project, searchable and exportable. Each row is an event:
                <Term>task.created</Term>, <Term>step.completed</Term>, <Term>task.approved</Term>,
                <Term>agent.registered</Term>, etc.
              </p>

              <H3>Features</H3>
              <Bullets>
                <li><strong>Filter</strong> by level (debug/info/warn/error) and component (task/agent/daemon/wizard/runtime/system).</li>
                <li><strong>Search</strong> free text across actions and payloads; trace-ID lookup links related events.</li>
                <li><strong>Export</strong> — JSONL or CSV download of the log.</li>
                <li><strong>Retention &amp; purge</strong> — pick how long entries live (7 days to forever); old rows purge automatically, or purge now with a button.</li>
                <li><strong>Dead-lettered steps</strong> — exhausted steps appear at the top of this tab with their last error and a one-click <em>Requeue</em>.</li>
              </Bullets>
              <p className="text-sm">
                Also here: <strong>Recently Deleted Tasks</strong> (30-day restore window) and{' '}
                <strong>from/to date filters</strong> that apply to both the log view and exports.
              </p>
            </Section>

            <Section id="help-settings-modes" title="Settings · Modes">
              <p>
                Manage the project&apos;s modes — the built-in five plus any custom ones you add.
              </p>
              <Bullets>
                <li><strong>Name, label, colour, icon</strong> — how the mode shows up in pickers and on steps.</li>
                <li><strong>Instructions</strong> (markdown) — merged into every prompt that uses this mode.</li>
                <li><strong>Max attempts</strong> — the default retry budget for steps created in this mode. A step’s own <em>maxRetries</em> still wins; blank falls back to the global default of 2.</li>
                <li><strong>Output format</strong> — markdown / JSON / diff / plain. Appended to the prompt as a one-line hint (“Respond in json format.”). A nudge, not a guarantee — validate downstream if a machine consumes the output.</li>
                <li><strong>Tool allowlist</strong> — one namespaced pattern per line: <code>github__create_issue</code> for an exact tool, <code>filesystem__*</code> for everything on a connection. Blank means no restriction. This narrows <em>on top of</em> the built-in mode heuristics (read-only modes like <Term>analyze</Term> already lose write-ish tools) and the per-connection tool toggles — a tool must survive all three filters to reach the agent.</li>
              </Bullets>
              <TipBox>
                Use the allowlist to make a mode <em>provably</em> narrow: a <Term>review</Term> mode allowed only
                <code> github__get_pull_request</code> and <code>github__create_review_comment</code> cannot merge,
                push, or delete anything no matter what the prompt says.
              </TipBox>
            </Section>

            <Section id="help-settings-runtimes" title="Settings · Runtimes">
              <p>
                Covered in <Ref href="#help-runtimes-add">Adding a runtime</Ref>. Same page lets you edit a
                runtime&apos;s adapter, env-var reference, endpoint, and model list (with live discovery), or
                delete it. Remember: the key itself lives in the server&apos;s environment — this page stores
                only the variable name.
              </p>
              <p className="text-sm">
                Each runtime card carries a <strong>connectivity test</strong> (one tiny prompt, latency shown
                inline) and a <strong>30-day usage line</strong> — runs, tokens, and cost where the provider
                reports it.
              </p>
            </Section>

            <Section id="help-settings-mcp" title="Settings · MCP">
              <p>
                Manage MCP connections: name, type, icon, and the HTTP endpoint Conductor calls
                <code> tools/list</code> / <code>tools/call</code> against. Agents pick which connections they
                can see in their own settings.
              </p>
              <p className="text-sm">
                The wrench button on each connection <strong>discovers the server&apos;s live tool list</strong>{' '}
                and lets you enable/disable individual tools — unchecked tools are hidden from agents at
                dispatch. All-checked means &ldquo;no restriction&rdquo;, so new server tools stay available
                automatically.
              </p>
              <Callout tone="purple" title="🛣 Still on the roadmap (Epic S5 leftovers)">
                <p>Per-tool usage stats.</p>
              </Callout>
            </Section>

            <Section id="help-settings-templates" title="Settings · Templates">
              <p>
                Two kinds of reusable building blocks live here:
              </p>
              <Bullets>
                <li><strong>Chain templates</strong> — reusable workflows with a step editor (mode + agent role + instructions per step). See <Ref href="#help-chain-templates">Chain templates</Ref>.</li>
                <li><strong>Task templates</strong> — saved task-form defaults: title pattern, description, priority, tag, notes, and optionally an attached chain template. A <em>Start from template</em> picker appears at the top of the create-task dialog; picking one prefills the form (and the step builder, if a chain is attached). Everything stays editable — it&apos;s a prefill, not a lock.</li>
              </Bullets>
              <TipBox>
                Put <code>{'{date}'}</code> in a title pattern and it expands to today&apos;s date when you pick
                the template — handy for recurring tasks like &ldquo;Standup notes {'{date}'}&rdquo;.
              </TipBox>
            </Section>

            <Section id="help-settings-analytics" title="Settings · Analytics">
              <p>
                A smaller, project-scoped version of the <Ref href="#help-obs-overview">Observability dashboard</Ref>.
                KPI tiles plus a 30-day chart of completed tasks and average cycle time. Use this when you want to
                answer &ldquo;how is this project doing?&rdquo; without leaving settings.
              </p>
            </Section>

            <Section id="help-settings-automation" title="Settings · Automation">
              <p>
                The project scheduler: pick a mode (manual / startup / always / scheduled), a poll interval,
                and — for scheduled mode — a weekly time window. Play/Stop controls the poller directly. Full
                detail in <Ref href="#help-automation-dispatch">Configuring automation</Ref>.
              </p>
              <H3 id="help-automation-rules">Automation rules (internal actions)</H3>
              <p>
                Rules live in <Ref href="#help-settings-integrations">Settings &middot; Integrations</Ref>, because a
                rule <em>is</em> a trigger + a reaction — just one that points <strong>inward</strong>. Alongside
                &ldquo;post to Slack&rdquo; you&apos;ll find internal actions that change Conductor state:
              </p>
              <Bullets>
                <li><code>task:assign</code> — give the task an agent, by id or by role (skips if already assigned; <code>force: true</code> overrides).</li>
                <li><code>task:set-priority</code> / <code>task:set-retry</code> — set priority, or give all <em>pending</em> steps a new retry policy.</li>
                <li><code>task:archive</code> — tuck a DONE task away. Archived &ne; deleted: it&apos;s kept forever, just off the board (<code>POST /api/tasks/:id/unarchive</code> brings it back).</li>
                <li><code>step:escalate</code> — bump the task one rung up the priority ladder and/or swap the step to its fallback agent.</li>
              </Bullets>
              <TipBox>
                Recipe: trigger on <Term>task-created</Term> with filter <code>tag equals backend</code> →
                reaction <code>task:assign</code> with <code>{'{"agentRole": "developer"}'}</code>. Every backend
                task self-assigns the moment it lands.
              </TipBox>
              <WatchIt>
                Internal actions never fire project events, so a rule can&apos;t set off another rule — no
                accidental loops. They&apos;re also idempotent (re-firing is harmless) and every real mutation
                lands in the activity log as <code>automation_rule_fired</code>. Rehearse a rule with the
                <strong> dry run</strong> toggle first: it logs what would happen and touches nothing.
              </WatchIt>
              <H3 id="help-automation-time-rules">Time-based rules (the sweep)</H3>
              <p>
                Two automation knobs live right on this tab: <strong>Flag DONE tasks idle for N days</strong>{' '}
                and <strong>Flag human gates waiting over N hours</strong>. An hourly sweep turns matches into
                synthetic events — <code>task-stale</code> and <code>review-gate-stale</code> — which flow
                through the same trigger/filter/reaction pipeline as everything else. The sweep itself never
                touches a task; what happens is up to your triggers.
              </p>
              <TipBox>
                The classic pairing: set <em>auto-archive</em> to 30 days, then add a trigger on{' '}
                <Term>task-stale</Term> with the internal action <code>task:archive</code>. Done tasks tidy
                themselves away after a month — and archived &ne; deleted, so they&apos;re all still in{' '}
                <em>Settings &rarr; Activity &rarr; Archived Tasks</em>, one Unarchive click from coming back.
                For stale review gates, pair <Term>review-gate-stale</Term> with <code>step:escalate</code>{' '}
                and/or a Slack post.
              </TipBox>
              <H3 id="help-automation-recurring">Recurring tasks</H3>
              <p>
                The Automation tab can also <strong>create</strong> work, not just dispatch it: pick a{' '}
                <Ref href="#help-settings-templates">task template</Ref>, a cadence (daily / weekly /
                monthly) and a time, and Conductor instantiates the task on schedule. If the template has
                a chain attached, the chain starts immediately — agent roles in the template resolve to
                your project&apos;s agents automatically.
              </p>
              <TipBox>
                Recurring creation fires the normal <Term>task-created</Term> event, so your automation
                rules compose: a recurring &ldquo;weekly dependency audit&rdquo; task can be auto-assigned
                by the same <code>task:assign</code> rule that handles everything else.
              </TipBox>
            </Section>

            <Section id="help-settings-integrations" title="Settings · Integrations">
              <p>
                Where Triggers and Reactions are configured. See <Ref href="#help-integrations">Triggers &amp; Reactions</Ref> for the full reference.
                Each Trigger card shows:
              </p>
              <Bullets>
                <li>A status dot — green (enabled, no errors), yellow (enabled, has consecutive failures), grey (disabled).</li>
                <li>The event type or &ldquo;Sentry poll&rdquo; badge.</li>
                <li>A reaction count.</li>
                <li>Enable/disable toggle and a <strong>Test</strong> button to fire manually.</li>
              </Bullets>
              <p>
                Expand a Trigger card to see and manage its Reactions. Each Reaction shows its type badge, order,
                consecutive failure count, and last error if any.
              </p>
            </Section>

            {/* ════════════════════════════════════════════════════════════════
                DAEMON MODE
               ════════════════════════════════════════════════════════════════ */}

            <Section
              id="help-daemon"
              title="Daemon mode overview"
              subtitle="Welcome to the developer guide! It starts here. Grab a coffee — this is the fun part."
            >
              <PlainEnglish>
                <p>
                  HTTP agents are like food delivery: Conductor calls, the agent answers, transaction over.
                  A daemon is a <strong>chef who lives in your kitchen</strong>: always there, knives already
                  sharp, pulls the next order off the rail whenever it&apos;s free.
                </p>
              </PlainEnglish>

              <p>
                Concretely: a daemon-mode agent is a process <em>you</em> run — on your laptop, a VM, a container.
                It registers with Conductor on startup, heartbeats every 30 seconds (&ldquo;still alive!&rdquo;),
                and pulls steps off a queue when it&apos;s idle. It&apos;s the right fit when your agent is a CLI
                tool (Claude Code, Aider, Codex) that benefits from a warm process, or needs local state — a
                checked-out repo, a GPU, a local model.
              </p>

              <TipBox>
                <p>
                  Want to see a complete, working daemon in ~300 lines before writing your own?
                  <code> mini-services/conductor-daemon</code> in the repo implements the entire protocol —
                  register, heartbeat, poll, sessions, completion — and its README documents every endpoint it
                  calls. Steal liberally; that&apos;s what it&apos;s for.
                </p>
              </TipBox>

              <H3>How it differs from HTTP mode</H3>
              <Bullets>
                <li><strong>Direction</strong> — daemon calls <em>in</em>; HTTP is called.</li>
                <li><strong>Lifetime</strong> — daemon is persistent; HTTP is request-scoped.</li>
                <li><strong>State</strong> — daemon can keep files, processes, caches between steps; HTTP cannot.</li>
                <li><strong>Failure</strong> — daemon failures show up as heartbeat loss; HTTP failures as non-2xx responses.</li>
              </Bullets>
            </Section>

            <Section id="help-daemon-setup" title="Setting up the daemon">
              <Steps>
                <Step title="Create a DAEMON-mode agent.">
                  {' '}In the agent creation modal, set <em>Invocation mode</em> to <Term>DAEMON</Term>.
                </Step>
                <Step title="Register the daemon (one-time, admin-assisted).">
                  {' '}Registration is deliberately admin-gated. From <code>mini-services/conductor-daemon</code>:
                  <Callout tone="cobalt" title="One-time registration">
                    <pre className="text-[11px] font-mono bg-surface/40 p-3 rounded border border-border/30 overflow-x-auto">
{`CONDUCTOR_URL=http://localhost:3000 \\
CONDUCTOR_ADMIN_COOKIE="agentboard_admin_session=…; agentboard_admin_nonce=…" \\
bun index.ts --register`}
                    </pre>
                  </Callout>
                  {' '}This prints <code>CONDUCTOR_DAEMON_TOKEN=cd_daemon.…</code> exactly once — save it. The
                  daemon also persists an installation ID so your machine keeps one durable Host identity.
                </Step>
                <Step title="Run the daemon.">
                  {' '}<code>CONDUCTOR_DAEMON_TOKEN=cd_daemon.… bun index.ts</code>. It heartbeats every 30s and
                  polls for leased steps every 5s. Watch it appear under <em>Runtime dashboard &rarr; Hosts</em>.
                </Step>
                <Step title="(Optional) declare a session policy.">
                  {' '}On the agent&apos;s runtime config, set <code>sessionPolicy</code> / <code>commandTemplate</code>
                  {' '}to run steps inside persistent local sessions — output streams into the Sessions tab. Without
                  a command template the reference daemon runs a safe no-op echo (it never executes step
                  instructions as shell by default).
                </Step>
                <Step title="Keep it running.">
                  {' '}Under a process manager (systemd, launchd, a Windows service) for production, or a terminal
                  tab for development. The README in <code>mini-services/conductor-daemon</code> covers every env var.
                </Step>
              </Steps>
            </Section>

            <Section id="help-daemon-heartbeat" title="Heartbeat & registration">
              <H3>Registration</H3>
              <p>
                On startup the daemon POSTs to <code>/api/daemon/register</code> with its agent key. Conductor
                returns a daemon ID and an initial poll token. The agent record&apos;s <em>last seen</em> timestamp
                updates.
              </p>

              <H3>Heartbeat</H3>
              <p>
                The daemon calls <code>/api/daemon/heartbeat</code> every 30 seconds (configurable). Each heartbeat
                carries the daemon&apos;s current in-flight step count, CPU/memory metrics (optional), and a
                &ldquo;ready for more work&rdquo; flag.
              </p>

              <H3>Timeouts</H3>
              <p>
                If a daemon misses three heartbeats (90 seconds default), Conductor marks it
                <em> red/disconnected</em>. Any steps it had claimed are returned to the queue after the same
                timeout so another agent can pick them up. When the daemon eventually reconnects, it is told to
                drop any ghost state and start fresh.
              </p>
            </Section>

            <Section id="help-daemon-steps" title="Claiming steps">
              <H3>The claim loop</H3>
              <Steps>
                <Step title="Poll for work.">{' '}<code>GET /api/daemon/steps/next</code>. Returns the next eligible step or <code>204 No Content</code>.</Step>
                <Step title="Claim.">{' '}Conductor reserves the step against this daemon; other daemons won&apos;t see it.</Step>
                <Step title="Run.">{' '}The daemon executes the step: invokes the CLI, captures output, uploads artifacts.</Step>
                <Step title="Report completion.">{' '}<code>POST /api/agent/tasks</code> with the final output or error.</Step>
                <Step title="Free the slot.">{' '}The daemon decrements its in-flight count and polls for more.</Step>
              </Steps>

              <Callout tone="amber" title="Terminal failures are not silent">
                <p>
                  As of 0.3, if a daemon-mode step crashes before reporting — the process dies, the tool throws,
                  the machine loses power — Conductor drives the task state machine exactly the same way it does
                  for an HTTP failure: the step fails, the chain handles it according to its retry policy, and
                  nothing gets stuck in <Term>IN_PROGRESS</Term> forever. Prior versions sometimes did; that&apos;s
                  fixed.
                </p>
              </Callout>
            </Section>

            {/* ════════════════════════════════════════════════════════════════
                APIs (ADVANCED)
               ════════════════════════════════════════════════════════════════ */}

            <Section
              id="help-api-cli"
              title="CLI-style API"
              subtitle="The whole agent protocol in one endpoint and four verbs. You could build an agent in bash before lunch."
            >
              <p>
                Here&apos;s a secret that makes Conductor much less intimidating: <strong>an agent is just a loop
                that asks for work, does it, and reports back.</strong> The CLI API is that loop with zero
                ceremony — one endpoint, four verbs, plain bodies. If you can write a shell script, you can write
                an agent. (The curl example below IS a complete agent. Really.)
              </p>

              <H3>Endpoint</H3>
              <Bullets>
                <li><code>GET /api/cli</code> — return the next task assigned to this agent, or <code>204</code> if none.</li>
                <li><code>POST /api/cli</code> — perform an action. Body: <code>{`{ "action": "...", ... }`}</code>.</li>
              </Bullets>

              <H3>Actions</H3>
              <Table
                head={['Action', 'Payload', 'Effect']}
                rows={[
                  [<Term key="a">claim</Term>, <code key="a2">{`{ task_id }`}</code>, 'Reserves the task for this agent. Moves to IN_PROGRESS.'],
                  [<Term key="b">start</Term>, <code key="b2">{`{ task_id }`}</code>, 'Records that the agent has begun. No state change.'],
                  [<Term key="c">complete</Term>, <code key="c2">{`{ task_id, output }`}</code>, 'Marks the task done (or review). Output is stored as an artifact.'],
                  [<Term key="d">fail</Term>, <code key="d2">{`{ task_id, error }`}</code>, 'Marks the task failed. Triggers the chain failure handler.'],
                ]}
              />

              <H3>Example</H3>
              <Callout tone="cobalt" title="Claim and complete">
                <pre className="text-[11px] font-mono bg-surface/40 p-3 rounded border border-border/30 overflow-x-auto">
{`# Get the next task
curl -H "Authorization: Bearer $AGENT_KEY" http://localhost:3000/api/cli

# Claim it
curl -X POST -H "Authorization: Bearer $AGENT_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"action":"claim","task_id":"T123"}' \\
  http://localhost:3000/api/cli

# Complete with output
curl -X POST -H "Authorization: Bearer $AGENT_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"action":"complete","task_id":"T123","output":"Hello from bash!"}' \\
  http://localhost:3000/api/cli`}
                </pre>
              </Callout>
            </Section>

            <Section id="help-api-http" title="HTTP agent API">
              <p>
                The full agent REST API sits under <code>/api/agent/*</code> and <code>/api/agents/*</code>. Use
                this when you&apos;re writing a real SDK-backed agent. The endpoints map 1:1 to the UI operations:
              </p>
              <Bullets>
                <li><code>GET /api/agent/next</code> — poll for the next eligible task for this agent.</li>
                <li><code>POST /api/agent/tasks</code> — update the status of a task (started, completed, failed).</li>
                <li><code>GET /api/agents/:id</code> — read the agent record (modes supported, current config).</li>
                <li><code>GET /api/agents/:id/stats</code> — the metrics shown in the agent activity dashboard.</li>
              </Bullets>

              <H3>Task shape</H3>
              <p>
                A task response includes the fully-rendered prompt (with system, mode, and skill blocks already
                merged), the mode name, the chain step ID (if any), and any tool allowlist the agent needs to
                respect. This lets a thin agent runtime just forward the prompt to the model without reassembling
                context.
              </p>
            </Section>

            <Section id="help-api-auth" title="Authentication" subtitle="Three kinds of credentials. Pick the right badge for the door you're opening.">
              <PlainEnglish>
                <p>
                  Three doors, three badges. <strong>Agent key</strong>: &ldquo;I&apos;m Alice, give me work.&rdquo;
                  <strong> Admin session</strong>: &ldquo;I&apos;m the human in the browser.&rdquo;
                  <strong> Scoped API key</strong>: &ldquo;I&apos;m the CI pipeline / a webhook — let me read
                  metrics or file tasks, nothing else.&rdquo; Use the wrong badge and you get a polite 401, not
                  a partial success — by design.
                </p>
              </PlainEnglish>

              <p>
                Every agent-side request carries:
              </p>
              <Callout tone="cobalt">
                <pre className="text-[11px] font-mono bg-surface/40 p-3 rounded border border-border/30 overflow-x-auto">
{`Authorization: Bearer <key>`}
                </pre>
              </Callout>
              <p>
                For agent routes the key is the agent&apos;s API key. Conductor looks it up, resolves the agent
                record, and the record itself is the permission set: supported modes, tool allowlist, MCP
                connections. The badge <em>is</em> the job description.
              </p>

              <H3>Admin-only endpoints</H3>
              <p>
                Endpoints under <code>/api/admin/*</code> (and most mutating routes) require the admin session
                cookie — these are what the UI hits when you&apos;re signed in. Mutations also enforce a
                same-origin check, so a malicious website can&apos;t ride your cookie.
              </p>

              <H3>Scoped API keys (for integrations)</H3>
              <p>
                Issue these from <code>/api/admin/api-keys</code> for CI pipelines, webhooks, and dashboards.
                Each key carries explicit scopes — <code>read</code> lets it pull activity, analytics, hosts, and
                sessions; <code>write</code> lets it create tasks. The raw key is shown exactly once at issue
                time; only a prefix and a hash are stored. Revoked keys stay listed for audit.
              </p>

              <WatchIt>
                <p>
                  A presented Bearer token is <em>authoritative</em>: if you send a scoped key and it&apos;s wrong,
                  you get a 401 — Conductor never silently falls back to your browser session. Debugging tip:
                  a mysterious 401 with a valid session usually means a stale token header is tagging along.
                </p>
              </WatchIt>
            </Section>

            {/* ════════════════════════════════════════════════════════════════
                SECURITY
               ════════════════════════════════════════════════════════════════ */}

            <Section
              id="help-security"
              title="Admin login & session"
              subtitle="How authentication works in the browser."
            >
              <p>
                Conductor is admin-password protected, with <strong>layered credentials</strong>: the
                <code> AGENTBOARD_ADMIN_PASSWORD</code> env var bootstraps a fresh install, and a password set in
                <em> Settings &rarr; Security</em> overrides it from then on (stored as a slow scrypt hash). The
                env var stays your <strong>break-glass</strong> credential — clear the AdminConfig database row
                and it works again. After signing in, your browser carries a session cookie — HttpOnly,
                SameSite=Lax, HMAC-signed.
              </p>

              <H3>Session lifetime</H3>
              <Bullets>
                <li>Configurable in <em>Settings &rarr; Security</em> (1 hour to 30 days; default 12 hours). Applies to new sign-ins.</li>
                <li>Changing the password invalidates every active session instantly — session tokens are derived from the credential itself.</li>
                <li>Mutating requests additionally pass a same-origin CSRF check, so a malicious site can&apos;t ride your cookie.</li>
              </Bullets>

              <WatchIt>
                <p>
                  Still one shared admin password (per-user accounts are a future epic). Share it narrowly and
                  rotate from <em>Settings &rarr; Security</em> whenever someone with access leaves — everyone
                  gets signed out, which is exactly what you want.
                </p>
              </WatchIt>
            </Section>

            <Section id="help-security-keys" title="Key storage" subtitle="The short version: Conductor stores hashes and names, never secrets it could leak.">
              <PlainEnglish>
                <p>
                  Two strategies, both ending in &ldquo;the database can&apos;t betray you&rdquo;: keys Conductor
                  <em> issues</em> (agent, project, integration keys) are stored as one-way hashes; keys Conductor
                  <em> uses</em> (provider API keys, reaction credentials) are stored as env-var <em>names</em> —
                  the values live only in the server&apos;s environment.
                </p>
              </PlainEnglish>

              <H3>What you see vs. what&apos;s stored</H3>
              <Bullets>
                <li><strong>Full key</strong> — shown once at creation or rotation, then never again. Copy it then or rotate again.</li>
                <li><strong>Preview</strong> — a short prefix/suffix for identification (<code>ab_1234…abcd</code>).</li>
                <li><strong>Hash</strong> — SHA-256, stored for lookup and verification. One-way: a database dump can&apos;t reveal a key.</li>
                <li><strong>Env-var reference</strong> — for provider/runtime keys and reaction secrets (Slack webhooks, Jira tokens, SMTP): the config stores the variable&apos;s <em>name</em>; the value is resolved from the environment at call time.</li>
              </Bullets>

              <H3>What to back up</H3>
              <p>
                The database (hashes and config) and your <code>.env</code> (the actual provider secrets). Lose
                the env file and your issued keys still work — but every runtime and reaction needs its secret
                re-set in the new environment.
              </p>
            </Section>

            <Section id="help-security-rotation" title="Key rotation">
              <p>
                Rotate early, rotate often.
              </p>
              <Bullets>
                <li><strong>Agent keys</strong> — <em>Settings &rarr; API Keys &rarr; [agent row] &rarr; Rotate</em>. The old key dies the instant the new one is issued — no overlap window, so be ready to update the agent&apos;s config immediately.</li>
                <li><strong>Project API key</strong> — same tab, <em>Rotate</em>. Breaks any external script still on the old key.</li>
                <li><strong>Integration (scoped) keys</strong> — no rotation; revoke and issue a fresh one. Revoked keys stay listed for audit.</li>
                <li><strong>Provider keys (runtimes, reactions)</strong> — rotate at the source: update the env var value on the server and restart. Nothing to change in Conductor — it only knows the variable&apos;s name.</li>
                <li><strong>Admin password</strong> — change <code>AGENTBOARD_ADMIN_PASSWORD</code> and restart; all sessions are invalidated.</li>
              </Bullets>
            </Section>

            {/* ════════════════════════════════════════════════════════════════
                TROUBLESHOOTING
               ════════════════════════════════════════════════════════════════ */}

            <Section id="help-trouble-ws" title="WebSocket shows Offline" subtitle="Don't panic. Nothing is lost — you've just lost the live ticker.">
              <PlainEnglish>
                <p>
                  The grey badge means the board stopped getting push updates. The work itself is fine — agents
                  keep working, dispatch keeps dispatching. You&apos;re watching a delayed broadcast, that&apos;s
                  all. Refresh to catch up while you fix the connection.
                </p>
              </PlainEnglish>
              <p>
                Symptom: the <Term>Live</Term> badge is grey, board doesn&apos;t update in real time. Tasks still
                dispatch, but you have to refresh to see new cards.
              </p>
              <H3>Checks</H3>
              <Bullets>
                <li>Is <code>board-ws</code> running? <em>Runtime dashboard &rarr; Services</em>. If it says <em>not running</em>, restart it.</li>
                <li>Is your browser blocking WebSockets? Some corporate proxies strip <code>Upgrade</code> headers. Try a different network.</li>
                <li>Check the browser console — a red <code>wss://...</code> error line is the WebSocket connection failing. Share it with whoever administrates the server.</li>
                <li>If the <Term>Live</Term> badge says <em>Realtime Off</em>, the server has disabled WebSockets entirely (check server env).</li>
              </Bullets>
            </Section>

            <Section id="help-trouble-stuck" title="A task is stuck" subtitle="The doctor will see you now. Symptom, diagnosis, cure — in that order.">
              <p>
                Symptom: a task sits in <Term>IN_PROGRESS</Term> for hours, no activity, no completion.
              </p>
              <TipBox>
                <p>
                  Before touching anything: stuck tasks are almost never <em>lost</em> tasks. The lease system
                  means a dead worker&apos;s step gets reclaimed automatically after the timeout, and exhausted
                  steps land in the dead-letter panel (<em>Settings &rarr; Activity</em>) with a one-click
                  Requeue. Diagnose first; the cure is usually one button.
                </p>
              </TipBox>
              <H3>Diagnosis</H3>
              <Bullets>
                <li>Open the task drawer &rarr; <em>Steps</em> tab. Which step is current?</li>
                <li>Click the step &rarr; look at the most recent attempt. Does it have a tool call pending? (The agent might be waiting on a tool that never returned.)</li>
                <li>Check the agent&apos;s status dot. Red = daemon disconnected. Amber = rate-limited. Click through to <em>Activity</em> to see the last error.</li>
                <li>Check the <Ref href="#help-obs-runtime">Runtime dashboard</Ref> &rarr; queue depth. If it&apos;s high everywhere, you&apos;re capacity-starved; the task isn&apos;t stuck, it&apos;s just waiting.</li>
              </Bullets>

              <H3>Actions</H3>
              <Bullets>
                <li><strong>Re-dispatch</strong> from the drawer — runs the current step again with the same agent.</li>
                <li><strong>Reassign</strong> to a different agent if you suspect agent-specific trouble.</li>
                <li><strong>Cancel</strong> — kills the current step and returns the task to <Term>BACKLOG</Term>.</li>
              </Bullets>
            </Section>

            <Section id="help-trouble-agent" title="An agent won't claim">
              <p>
                Symptom: task is in <Term>BACKLOG</Term>, agent shows green/idle, but nothing happens.
              </p>
              <H3>Checks</H3>
              <Bullets>
                <li>Does the agent support the task&apos;s mode? (<em>Settings &rarr; Agents &rarr; [agent] &rarr; Supported modes</em>.) A mode-mismatched task won&apos;t be offered.</li>
                <li>Is the agent at max concurrent? Check the agent row in the Runtime dashboard — if it already has N tasks, it won&apos;t claim another.</li>
                <li>Is there a dispatch rule filtering this task out? Look at <em>Settings &rarr; Automation</em> and try the <em>Dry run</em> against this task.</li>
                <li>For daemon agents, is the daemon actually polling? Watch the daemon log; every two seconds you should see a poll request.</li>
              </Bullets>
            </Section>

            <Section id="help-trouble-daemon" title="Daemon keeps disconnecting">
              <p>
                Symptom: daemon agent&apos;s status dot flickers red/green. Heartbeats miss. Steps land back in the
                queue.
              </p>
              <H3>Common causes</H3>
              <Bullets>
                <li><strong>Network flap</strong> — daemon&apos;s uplink is unreliable. Run it closer to Conductor, or raise the heartbeat timeout.</li>
                <li><strong>Process killed by OOM</strong> — CLI-backed daemons with generous context can balloon. Check dmesg / system logs. Lower max-concurrent.</li>
                <li><strong>Clock drift</strong> — if the daemon&apos;s clock is more than a minute off, heartbeats fail the timestamp check. Run NTP.</li>
                <li><strong>Version mismatch</strong> — daemon running against a newer/older server. Keep versions in lockstep.</li>
              </Bullets>
            </Section>

            <Section id="help-trouble-clear" title="Clearing data & reset">
              <H3>Soft clears</H3>
              <Bullets>
                <li><em>Settings &rarr; Activity &rarr; Clear old events</em> — drops activity log rows older than the retention window.</li>
                <li><em>Settings &rarr; General &rarr; Clear artifacts</em> — drops artifacts for <Term>DONE</Term> tasks older than N days.</li>
                <li>Delete individual tasks or agents from their respective tables.</li>
              </Bullets>
              <H3>Hard reset</H3>
              <p>
                To wipe everything: stop the server, delete the database file (SQLite) or drop the schema
                (Postgres), run <code>bun run db:push</code>, and start again. The workspace, projects, agents,
                tasks, activity, skills — all gone.
              </p>
              <Callout tone="amber" title="Back up first">
                <p>
                  Conductor doesn&apos;t have a &ldquo;soft reset&rdquo;. If the database looks corrupt and you want
                  to start fresh, copy the file (or pg_dump the schema) somewhere safe before wiping. Recovering
                  activity later is usually easier than rebuilding state from scratch.
                </p>
              </Callout>
            </Section>

            {/* ════════════════════════════════════════════════════════════════
                REFERENCE
               ════════════════════════════════════════════════════════════════ */}

            <Section id="help-faq" title="FAQ" subtitle="The questions everyone asks in week one. Asked and answered, no judgement.">
              <DumbQuestions
                items={[
                  ['Is Conductor a chat UI?', <>No. Conductor dispatches work to agents and tracks the outcomes. Want to chat with a model? Use the provider&apos;s own client — it&apos;s better at chatting than we&apos;ll ever try to be.</>],
                  ['Do I need Docker or Postgres?', <>Nope. SQLite is the zero-config default and runs everything. Postgres + pgvector buys you semantic skill search and better concurrency when you outgrow a single file — and not a day before.</>],
                  ['Can I run it on my laptop?', <><code>bun install &amp;&amp; bun run db:push &amp;&amp; bun run dev</code> — that&apos;s the whole install. You need one API key for one runtime (Anthropic, OpenAI, OpenRouter, or a local Ollama). Run <code>bun run doctor</code> afterwards and it will tell you what, if anything, is missing.</>],
                  ['Can several people use it at once?', <>Yes — the WebSocket pushes changes to every open browser, and the activity log records who did what. One caveat: there&apos;s a single shared admin password today; per-user accounts are on the roadmap.</>],
                  ['Does Conductor train models?', <>No. It&apos;s a dispatcher. Prompts go to whatever model your runtime points at; the providers run the models. Your data goes where your runtimes send it — choose them accordingly.</>],
                  ['Can agents talk to each other?', <>Yes — through Conductor&apos;s message inboxes, never directly. Agents send task-aware messages via their API keys; every message is durable, scanned for prompt injection, and visible to admins in the task drawer. For passing <em>work output</em> downstream, a chain is still the right tool — messages are for questions and handoffs, not the pipeline itself.</>],
                  ['What does it cost to run?', <>Infrastructure: peanuts — one server, one database. The AI provider bills are the real line item. Set <em>Max cost per step</em>, watch the Observability cost tile, and remember that a runaway retry loop is the most expensive bug you can have. (The dead-letter queue and backoff exist precisely for this.)</>],
                  ['Something broke. Where do I look, in order?', <>1) The task drawer&apos;s step output viewer — the rendered prompt is the answer 90% of the time. 2) The step&apos;s Evidence panel — what did the agent actually rely on? 3) <em>Settings &rarr; Activity</em> — warnings and dead letters. 4) <code>bun run doctor</code> — config and connectivity. In four stops you&apos;ve seen everything Conductor knows.</>],
                ]}
              />
            </Section>

            <Section id="help-glossary" title="Glossary">
              <dl className="grid grid-cols-1 md:grid-cols-[160px_1fr] gap-x-6 gap-y-3 text-sm">
                {([
                  ['Activity', 'An append-only log of every state change in a project. The audit trail.'],
                  ['Agent', 'A configured worker record — name, runtime, modes, key. Can be HTTP-invoked or run as a daemon.'],
                  ['Artifact', 'A file produced by an agent during a step. Kept against the task.'],
                  ['Attempt', 'One execution of a step. A step can have many attempts if retried.'],
                  ['Automation', 'Internal rules that react to Conductor events (task created, moved, tagged).'],
                  ['Reaction', 'A typed action (Slack, HTTP, Jira, email) that fires when a Trigger matches. Reactions run sequentially.'],
                  ['Board', 'The Kanban view. Four columns: Backlog, In Progress, Review, Done.'],
                  ['Chain', 'An ordered workflow of steps.'],
                  ['Chain template', 'A saved, reusable chain definition.'],
                  ['Claim', 'The act of an agent reserving a task. Moves the task to In Progress.'],
                  ['Daemon', 'A long-lived agent process that registers and pulls work.'],
                  ['Dispatch', 'The act of sending a task (and its prompt) to a specific agent in a specific mode.'],
                  ['Gate', 'A human-approval checkpoint inside a chain.'],
                  ['Handoff', 'The automatic transition from one chain step to the next.'],
                  ['Mode', 'A role the agent is playing (ANALYZE, DEVELOP, etc.). Changes prompt and tool access.'],
                  ['MCP', 'Model Context Protocol. The standard Conductor speaks to expose tools to agents.'],
                  ['Project', 'A bounded unit of work inside a workspace. Has its own board, agents, keys, MCP connections.'],
                  ['Runtime', 'A credentialed connection to an AI provider.'],
                  ['Skill', 'A reusable prompt fragment or playbook in the workspace-wide library.'],
                  ['Step', 'A single node in a chain. Pairs a mode with an agent and has attempts.'],
                  ['Task', 'A unit of work. A card on the board.'],
                  ['Trigger', 'A project-scoped rule that watches for an event (or polls Sentry) and fires a chain of Reactions.'],
                  ['Template', 'A saved form — task template or chain template.'],
                  ['WAITING', 'A transient state where a task is paused for an external event.'],
                  ['Workflow', 'An alias for a chain, sometimes used to emphasise branching/parallel flows.'],
                  ['Workspace', 'The top-level container. Holds projects, agents, runtimes, skills.'],
                ] as const).map(([term, def]) => (
                  <Fragment key={term}>
                    <dt className="font-semibold text-foreground">{term}</dt>
                    <dd className="text-foreground/75 leading-[1.55]">{def}</dd>
                  </Fragment>
                ))}
              </dl>
            </Section>

            <Section id="help-shortcuts" title="Keyboard shortcuts">
              <p>
                Conductor is still mostly driven by mouse and touch. The shortcuts below are the ones that are
                wired today. When typing into a text field they&apos;re suppressed, so <Kbd>?</Kbd> and <Kbd>/</Kbd>
                won&apos;t fire while you&apos;re writing a task description.
              </p>
              <Table
                head={['Shortcut', 'What it does', 'Where it works']}
                rows={[
                  [<Kbd key="qmark">?</Kbd>, 'Open (or close) this help page', 'Anywhere'],
                  [<Kbd key="slash">/</Kbd>, 'Focus the topic filter', 'Help page'],
                ]}
              />
            </Section>

            <Section id="help-storage" title="Where data is stored">
              <H3>SQLite (default)</H3>
              <p>
                A single file at <code>prisma/dev.db</code>. Everything lives in here: workspaces, projects,
                agents, tasks, steps, activity, skills, MCP connections, artifacts metadata. Artifacts themselves
                live on disk under <code>storage/artifacts/</code>.
              </p>

              <H3>PostgreSQL (recommended for teams)</H3>
              <p>
                Connection string in <code>DATABASE_URL</code>. The <code>pgvector</code> extension powers semantic
                skill search. Run <code>scripts/init-pgvector.sql</code> once to create the extension.
              </p>

              <H3>Logs</H3>
              <p>
                Server logs go to stdout (and <code>server.log</code> in production mode). Daemon logs are streamed
                from the daemon process itself and captured in the browser&apos;s Daemon log viewer; they are
                <em> not</em> persisted long-term by default.
              </p>

              <H3>Backups</H3>
              <p>
                Back up the database file (or use <code>pg_dump</code>), the artifacts directory, and the
                encryption key. Those three are enough to restore a Conductor from scratch.
              </p>
            </Section>

            {/* END-OF-CONTENT-MARKER */}
          </article>
        </div>
      </div>
    </div>
  )
}
