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

              <H3 id="help-release-0-3-roadmap">On the roadmap (not shipped)</H3>
              <p>
                External-event integrations — starting chains from GitHub/Slack/Jira webhooks and pushing results
                back — are designed but not yet built. The design doc lives at <code>docs/designs/integrations.md</code>.
                For today, chains are kicked off either by a human dragging a task to In Progress or by the
                project&apos;s automation poller.
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
              subtitle="An orchestration platform for AI agents, built around a board you already know how to use."
            >
              <p>
                Conductor is a <strong>control room for AI agents</strong>. Instead of running one chatbot at a time
                and pasting output into another tool, you define a cast of agents, give each one a role
                (analyse, verify, develop, review, draft), and then chain them together into workflows. The platform
                dispatches work to the right agent at the right time, pauses for a human whenever you want approval,
                and keeps a full audit trail of what every agent did.
              </p>

              <Callout tone="cobalt" title="The problem it solves">
                <p>
                  Most AI work today is either one shot (paste a prompt, get a response) or glued together with
                  scripts and cron jobs that break quietly. Conductor turns that ad-hoc glue into a visible,
                  inspectable process: every task is a card on a board, every agent has a status light, and every
                  decision — automated or human — leaves a timestamped record. You can see what&apos;s running,
                  what&apos;s blocked, and where to step in.
                </p>
              </Callout>

              <H3>What Conductor is good at</H3>
              <Bullets>
                <li><strong>Long, multi-step work</strong> — research &rarr; draft &rarr; review &rarr; ship, handed between different agents with clear boundaries.</li>
                <li><strong>Work that needs a human checkpoint</strong> — an agent does 90% and a person approves the last mile.</li>
                <li><strong>Mixing AI providers</strong> — one project can use Claude for analysis, a local model for coding, and GPT for copy, all managed from the same board.</li>
                <li><strong>Auditable AI operations</strong> — every step&apos;s input, output, tool calls, and approvals are recorded.</li>
              </Bullets>

              <H3>What Conductor is not</H3>
              <Bullets>
                <li>Not a chat UI. If you want to talk to a model, use the provider&apos;s own client.</li>
                <li>Not a replacement for your project-management tool. Tasks on the Conductor board are <em>work units for agents</em>, not the canonical backlog of your team.</li>
                <li>Not a training platform. It orchestrates models you already have access to; it doesn&apos;t fine-tune them.</li>
              </Bullets>
            </Section>

            <Section id="help-audience" title="Who is this for?">
              <p>
                The guide is written with three kinds of reader in mind:
              </p>
              <Bullets>
                <li><strong>Operators and project leads</strong> who set up projects, create agents, and approve work. Most of this guide is for you — stay on Getting Started, The Board, Agents, Modes, and Chains.</li>
                <li><strong>Power users</strong> who want internal automation rules and reusable templates. Read Automation and Templates.</li>
                <li><strong>Developers</strong> building their own agents against Conductor&apos;s APIs. Jump to Daemon mode, APIs (advanced), and Security.</li>
              </Bullets>
              <Callout tone="teal" title="No code required for most of it">
                <p>
                  Everything in Getting Started through Observability is clickable in the UI. You only need the
                  Advanced APIs section if you&apos;re writing a new agent from scratch or scripting integrations.
                </p>
              </Callout>
            </Section>

            <Section
              id="help-concepts"
              title="Core concepts"
              subtitle="The nouns Conductor uses. Skim this now, come back when a term confuses you."
            >
              <H3>Workspace</H3>
              <p>
                The top-level container. A workspace is usually one team or one organisation. Switch workspaces from
                the dropdown next to the Conductor logo. Everything below — projects, agents, chains, skills — lives
                inside a workspace.
              </p>

              <H3>Project</H3>
              <p>
                A bounded unit of work inside a workspace: one product, one codebase, one campaign. Each project has
                its own board, its own agents, its own API keys, and its own MCP connections. You can have as many
                projects as you like.
              </p>

              <H3>Task</H3>
              <p>
                A single unit of work, shown as a card on the board. Tasks move through states (<Term>BACKLOG</Term>,
                <Term>IN_PROGRESS</Term>, <Term>WAITING</Term>, <Term>REVIEW</Term>, <Term>DONE</Term>) as agents
                and humans act on them. Every task has a title, an optional description, a priority, and an
                optional agent assignment.
              </p>

              <H3>Agent</H3>
              <p>
                A configured worker. An agent has a name, an emoji, a role, an AI provider (its <em>runtime</em>),
                a system prompt, and a set of modes it supports. Agents come in two invocation flavours:
                <Term>HTTP</Term> (the server calls the agent) and <Term>DAEMON</Term> (the agent calls the server
                for work). More on this in <Ref href="#help-agent-invocation">HTTP vs. Daemon</Ref>.
              </p>

              <H3>Mode</H3>
              <p>
                A role the agent is playing <em>right now</em>. Built-in modes are <Term>ANALYZE</Term>,
                <Term>VERIFY</Term>, <Term>DEVELOP</Term>, <Term>REVIEW</Term>, and <Term>DRAFT</Term>. Modes
                control the agent&apos;s system prompt, which tools it can use, and what kind of output it produces.
                See <Ref href="#help-modes">Modes</Ref>.
              </p>

              <H3>Chain</H3>
              <p>
                An ordered workflow of steps. Each step pairs a mode with an agent (&ldquo;analyse with Alice, then
                develop with Bob, then have a human review&rdquo;). Chains can be saved as templates and re-used on
                new tasks.
              </p>

              <H3>Skill</H3>
              <p>
                A reusable fragment — a prompt, a snippet, a playbook — stored in the workspace-wide skills library.
                Agents can retrieve skills by semantic similarity when answering a task. Think of it as long-term
                memory shared across agents.
              </p>

              <H3>Runtime</H3>
              <p>
                A credentialed connection to an AI provider: Anthropic, OpenAI, OpenRouter, Azure, local (Ollama),
                etc. Agents pick a runtime when they&apos;re created; runtimes are managed in <em>Settings &rarr; Runtimes</em>.
              </p>

              <H3>MCP connection</H3>
              <p>
                A link to a Model Context Protocol server. An MCP server exposes tools (functions) that an agent
                can call during a step — read a file, query a database, open a ticket. Each project picks which
                MCP connections its agents can see.
              </p>

              <H3>Artifact</H3>
              <p>
                A file produced by an agent during a step — a diff, a document, a CSV, an image. Artifacts are
                stored against the task and viewable from the task drawer.
              </p>

              <H3>Activity</H3>
              <p>
                Every state change (task created, claimed, started, completed, approved, rejected) is written to
                the activity log with a timestamp, an actor (agent or user), and any payload. Activity is your
                audit trail.
              </p>
            </Section>

            <Section
              id="help-quickstart"
              title="10-minute quick start"
              subtitle="The fastest path from zero to seeing an agent complete a task."
            >
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
                  OpenAI, …), paste your API key, give it a label. Your agents will use this to reach a model.
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

              <Callout tone="amber" title="If it doesn't move">
                <p>
                  The top bar shows a <Term>Live</Term> badge. If it&apos;s <Term>Offline</Term>, the WebSocket
                  isn&apos;t connected — the board won&apos;t update in real-time but dispatch still works; refresh
                  after a few seconds. If the task sits in <Term>BACKLOG</Term> for more than a minute, see
                  <Ref href="#help-trouble-agent">An agent won&apos;t claim</Ref>.
                </p>
              </Callout>
            </Section>

            <Section
              id="help-first-project"
              title="Your first project, step by step"
              subtitle="A detailed walkthrough — click, what-you-see, why."
            >
              <p>
                The quick start above is terse. This section is for readers who want every click documented.
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
                <li>Click the <Kbd>⚙</Kbd> Settings icon in the top bar &rarr; <em>Runtimes</em> tab.</li>
                <li>Click <em>+ Add Runtime</em>.</li>
                <li>Choose a <strong>Provider</strong> (Anthropic, OpenAI, OpenRouter, Ollama, …). Each provider exposes slightly different fields.</li>
                <li>Paste your <strong>API key</strong>. Keys are stored encrypted at rest and never shown again after save.</li>
                <li>Pick a default model (e.g. <code>claude-sonnet-4-6</code>). Agents can override this per-agent.</li>
                <li>Save. The runtime appears in the list with a green dot once a test call succeeds.</li>
              </Bullets>

              <Callout tone="amber" title="Key hygiene">
                <p>
                  Treat runtime API keys as secrets. Conductor encrypts them on disk, but anyone with admin access to
                  the server can trigger calls that burn your quota. Rotate keys on a schedule and revoke runtimes
                  you no longer use from this same screen.
                </p>
              </Callout>

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

              <Callout tone="teal" title="You're live">
                <p>
                  That&apos;s the full loop: project &rarr; runtime &rarr; agent &rarr; task &rarr; dispatched work &rarr;
                  review &rarr; done. Everything else in this guide is either <em>more of the same at scale</em>
                  (chains instead of single dispatches, daemons instead of HTTP, multiple providers, integrations)
                  or <em>tools to see what&apos;s happening</em> (observability, activity log, step output viewer).
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
              subtitle="Four columns, drag-and-drop, real-time updates. The main view."
            >
              <p>
                The board is deliberately familiar. If you&apos;ve used Trello, Jira, Linear, or any Kanban-style
                tool, you already know most of it. Cards flow left to right. Columns are states.
              </p>

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
                <em>Drawer &rarr; ⋯ menu &rarr; Delete</em>. Tasks are soft-deleted and kept in the activity log for 30 days,
                so you can resurrect them from <em>Settings &rarr; Activity</em>.
              </p>

              <H3>Bulk operations</H3>
              <p>
                Shift-click cards to multi-select, then use the floating action bar at the bottom to reassign,
                re-prioritise, or bulk-delete. Bulk moves respect the state machine — an illegal transition is
                refused with a red toast.
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

              <Callout tone="amber" title="Illegal transitions">
                <p>
                  Dragging from <Term>DONE</Term> back to <Term>IN_PROGRESS</Term> is allowed (the task is re-queued),
                  but dragging from <Term>BACKLOG</Term> straight to <Term>DONE</Term> is refused — closing a task
                  without any agent activity is almost always a mistake. If you truly need to do it, click the card
                  and use <em>Drawer &rarr; ⋯ menu &rarr; Force close</em>, which writes a reason to the activity log.
                </p>
              </Callout>
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
              subtitle="The &ldquo;pause for approval&rdquo; checkpoint that makes AI work safe to ship."
            >
              <p>
                Any step in a chain can be marked as <em>requires human approval</em>. When that step finishes, the
                task moves to <Term>REVIEW</Term> and the chain pauses. Nothing downstream runs until a human clicks
                <em>Approve</em> or <em>Reject</em>.
              </p>

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

              <Callout tone="purple" title="Budget limits">
                <p>
                  To stop an agent&apos;s rejection loop burning your quota, each step has a <em>max attempts</em>
                  counter (default 3). After that, the task parks in <Term>REVIEW</Term> permanently with a red
                  &ldquo;exhausted&rdquo; banner — a human has to intervene to move it. Tune this in
                  <em> Settings &rarr; Modes &rarr; [mode] &rarr; Max attempts</em>.
                </p>
              </Callout>
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
                An agent in Conductor is not a process. It&apos;s a <em>record</em>: a name, an emoji, a runtime, a
                set of supported modes, a system prompt, and an API key. The actual work runs either in
                Conductor&apos;s own worker pool (for HTTP agents) or in a separate long-running process you start
                yourself (for daemon agents). The record tells Conductor <em>who</em> the worker is and
                <em>what</em> it&apos;s allowed to do.
              </p>

              <Callout tone="teal" title="Mental model">
                <p>
                  Think of an agent like a job posting plus the employee who fills it. The record describes the job
                  (&ldquo;Alice is a developer who uses Claude Sonnet and can run ANALYZE and DEVELOP modes&rdquo;).
                  The runtime is Alice&apos;s toolkit. The system prompt is her onboarding document. The API key is
                  her badge.
                </p>
              </Callout>

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

              <Callout tone="amber" title="System prompt footguns">
                <p>
                  Keep the base prompt short. Long prompts cost tokens on every call and overwhelm smaller models.
                  Move mode-specific guidance into the per-mode override, and move reusable playbooks into the
                  <Ref href="#help-skills"> skills library</Ref> so agents can retrieve them on demand instead of
                  always carrying them.
                </p>
              </Callout>
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
              subtitle="Different hats an agent can wear. Changes the prompt, the toolset, and the output contract."
            >
              <p>
                A mode is a named <em>role</em> the agent is playing right now: analyst, verifier, developer,
                reviewer, writer. Modes are important because the same agent often behaves very differently
                depending on what you&apos;re asking it to do. <Term>DEVELOP</Term> mode can touch the filesystem;
                <Term>REVIEW</Term> mode only reads.
              </p>

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

              <H3>Why they exist</H3>
              <p>
                A raw LLM will happily conflate these. Ask it to &ldquo;fix this bug&rdquo; and it will sometimes
                plan, sometimes code, sometimes review its own code — all mixed. Splitting the work into modes
                gives you three practical wins:
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
              subtitle="An ordered workflow of steps. The unit of automation above a single dispatch."
            >
              <p>
                A chain is a list of steps, each paired with a mode and an agent, plus success/failure transitions.
                Chains are how Conductor does real work — single dispatches are fine for smoke tests, but any task
                worth automating is usually two or three steps minimum: <em>analyse &rarr; develop &rarr; review</em>.
              </p>

              <Callout tone="cobalt" title="The smallest useful chain">
                <p>
                  <Term>ANALYZE</Term> &rarr; <Term>DEVELOP</Term> &rarr; <Term>REVIEW</Term> with a human gate on
                  the last step. Three steps, three agents, one approval checkpoint. This single chain covers
                  most &ldquo;have an AI do it but let me approve&rdquo; workflows.
                </p>
              </Callout>

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

              <Callout tone="cobalt" title="Why a library instead of giant prompts">
                <p>
                  LLM context windows are finite and every token costs money. Cramming your entire playbook into
                  every agent&apos;s system prompt is wasteful and makes smaller models worse. Storing playbooks as
                  skills lets agents retrieve only the ones they need for the task at hand.
                </p>
              </Callout>

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

              <p>
                Think of MCP as the &ldquo;USB-C for LLM tools&rdquo;. Instead of writing one integration per agent
                and per provider, you write one MCP server and every MCP-capable client can use it.
              </p>

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
              <Steps>
                <Step title="Open Settings → Runtimes.">{' '}Click <em>+ Add Runtime</em>.</Step>
                <Step title="Pick a provider.">{' '}Each provider reveals the fields it needs (API key, endpoint, region, etc.).</Step>
                <Step title="Paste your key.">{' '}Stored encrypted. Once saved, the key is masked — rotating requires pasting a fresh one.</Step>
                <Step title="Pick a default model.">{' '}This is what agents use unless they override. Pick carefully — changing the default later doesn&apos;t migrate existing agents.</Step>
                <Step title="Test.">{' '}Click <em>Test call</em>. Conductor pings the provider with a short prompt. Green check = ready.</Step>
                <Step title="Save.">{' '}Runtime is immediately available in the agent creation picker.</Step>
              </Steps>

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

            {/* ════════════════════════════════════════════════════════════════
                OBSERVABILITY
               ════════════════════════════════════════════════════════════════ */}

            <Section
              id="help-obs-runtime"
              title="Runtime dashboard"
              subtitle="The live operations view."
            >
              <p>
                Open it from the <Kbd>📈</Kbd> icon in the top bar. The runtime dashboard is where you look when
                something feels slow or stuck.
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
              subtitle="Project-level defaults and retention."
            >
              <Bullets>
                <li><strong>Project name, colour, description</strong> — shown in the project selector and sidebar.</li>
                <li><strong>Default mode</strong> — the mode used when a task is dispatched without one.</li>
                <li><strong>Default chain</strong> — attached to new tasks automatically if no other chain is specified.</li>
                <li><strong>Retention</strong> — how long to keep activity log entries, artifacts, and step records. Shorter retention saves disk at the cost of debuggability.</li>
                <li><strong>Delete project</strong> — irreversible. Nuke the whole project, its agents, and all its history. Requires typing the project name to confirm.</li>
              </Bullets>
            </Section>

            <Section id="help-settings-agents" title="Settings · Agents">
              <p>
                Manage the cast of agents for this project. Covered in detail in
                <Ref href="#help-agent-create"> Creating an agent</Ref> and <Ref href="#help-agent-status">Active,
                idle, and muted</Ref>.
              </p>
              <Bullets>
                <li>Table of agents with status dot, active toggle, current task count.</li>
                <li>Row click opens the agent editor.</li>
                <li>Per-row menu: rotate key, view activity, duplicate, delete.</li>
                <li><em>+ New Agent</em> opens the creation wizard.</li>
              </Bullets>
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

              <H3>Admin session</H3>
              <p>
                A session cookie issued when you sign in with the admin password. Expires after the configured
                timeout (<em>Settings &rarr; General &rarr; Admin session timeout</em>). Rotating the admin password
                invalidates all existing sessions.
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
                <li><strong>Filter</strong> by actor (agent or user), event type, task, date range.</li>
                <li><strong>Search</strong> free text inside payloads.</li>
                <li><strong>Export CSV</strong> — up to 10,000 most recent rows.</li>
                <li><strong>Resurrect</strong> — for <Term>task.deleted</Term> rows, a button un-deletes the task (if within the retention window).</li>
              </Bullets>
            </Section>

            <Section id="help-settings-modes" title="Settings · Modes">
              <p>
                Manage built-in mode defaults and create custom modes. Built-in modes can&apos;t be deleted; you can
                only override their defaults.
              </p>
              <Bullets>
                <li>Default instructions (markdown) merged into every prompt that uses this mode.</li>
                <li>Tool allowlist shared by all agents when running in this mode.</li>
                <li>Max attempts for chain steps in this mode.</li>
                <li>Output format hint.</li>
              </Bullets>
            </Section>

            <Section id="help-settings-runtimes" title="Settings · Runtimes">
              <p>
                Covered in <Ref href="#help-runtimes-add">Adding a runtime</Ref>. Same page lets you:
              </p>
              <Bullets>
                <li>Rotate keys.</li>
                <li>See recent usage (calls, tokens, cost if the provider reports it).</li>
                <li>Archive a runtime to hide from pickers without deleting — breaks any agent that still points at it.</li>
                <li>Delete a runtime — refused if any active agent still uses it.</li>
              </Bullets>
            </Section>

            <Section id="help-settings-mcp" title="Settings · MCP">
              <p>
                Manage MCP connections. Covered in <Ref href="#help-mcp-connect">Connecting a server</Ref>. Also on
                this page:
              </p>
              <Bullets>
                <li>Discover refresh — re-fetch the tool list from the server (run after server-side updates).</li>
                <li>Per-tool usage stats — how often each tool has been called, from which agent.</li>
                <li>Disable a tool without removing the connection — useful for temporarily gating a risky operation.</li>
              </Bullets>
            </Section>

            <Section id="help-settings-templates" title="Settings · Templates">
              <p>
                The one-stop shop for task templates and chain templates. See
                <Ref href="#help-templates"> Task templates</Ref> and
                <Ref href="#help-chain-templates"> Chain templates</Ref>.
              </p>
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
                Where auto-dispatch rules live. See <Ref href="#help-automation-dispatch">Auto-dispatch rules</Ref>.
                Also on this page:
              </p>
              <Bullets>
                <li><strong>Escalation rules</strong> — notify a channel if a <Term>REVIEW</Term> task ages past a threshold.</li>
                <li><strong>Archive rules</strong> — auto-archive <Term>DONE</Term> tasks after N days.</li>
                <li><strong>Retry policy defaults</strong> — default backoff and max-attempts applied when chain steps don&apos;t override.</li>
              </Bullets>
            </Section>

            {/* ════════════════════════════════════════════════════════════════
                DAEMON MODE
               ════════════════════════════════════════════════════════════════ */}

            <Section
              id="help-daemon"
              title="Daemon mode overview"
              subtitle="Long-lived agent processes that pull work. For CLI-backed and stateful agents."
            >
              <p>
                A daemon-mode agent is a process you run yourself — on your laptop, in a VM, or in a container.
                It registers with Conductor on startup, heartbeats periodically, and pulls steps from a queue when
                it&apos;s idle. This is the right fit when your agent is a CLI tool (Claude Code, Aider, OpenCode,
                Codex) that benefits from process reuse or needs local state (a checked-out repository, a warm
                local model).
              </p>

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
                <Step title="Create the agent record.">
                  {' '}Mark it <Term>DAEMON</Term> in the creation wizard. Conductor generates an API key.
                </Step>
                <Step title="Install the daemon.">
                  {' '}Conductor ships a reference daemon (<code>conductor-agent</code>) as an npm package. Install
                  with <code>bun add -g conductor-agent</code> (or npm). For custom daemons, see the SDK.
                </Step>
                <Step title="Configure the daemon.">
                  {' '}Point it at your Conductor URL and paste the agent key:
                  <Callout tone="cobalt" title="conductor-agent.config.json">
                    <pre className="text-[11px] font-mono bg-surface/40 p-3 rounded border border-border/30 overflow-x-auto">
{`{
  "server": "https://your-conductor.example.com",
  "agentKey": "ab_xxxxxxxx",
  "maxConcurrent": 1,
  "pollIntervalMs": 2000
}`}
                    </pre>
                  </Callout>
                </Step>
                <Step title="Start the daemon.">
                  {' '}<code>conductor-agent --config conductor-agent.config.json</code>. It registers,
                  heartbeats, and starts claiming work. The agent&apos;s status dot turns green in the UI.
                </Step>
                <Step title="Keep it running.">
                  {' '}Under a process manager (systemd, pm2, Windows service) for production, or just a terminal
                  tab for development.
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
              subtitle="A simple text-based endpoint for shell-script agents."
            >
              <p>
                The CLI API is the smallest possible surface for an agent: one endpoint, four verbs, text bodies.
                Good for quick scripts and for wrapping non-HTTP tools.
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

            <Section id="help-api-auth" title="Authentication">
              <p>
                Every agent-side request carries:
              </p>
              <Callout tone="cobalt">
                <pre className="text-[11px] font-mono bg-surface/40 p-3 rounded border border-border/30 overflow-x-auto">
{`Authorization: Bearer <key>`}
                </pre>
              </Callout>
              <p>
                The key is the agent&apos;s API key. Conductor looks it up, resolves the agent record, and uses that
                to authorise the call. There&apos;s no separate &ldquo;scope&rdquo; system — the agent record itself
                carries the scope (supported modes, tool allowlist, MCP connections).
              </p>

              <H3>Admin-only endpoints</H3>
              <p>
                Endpoints under <code>/api/admin/*</code> require a valid admin session cookie, not an agent key.
                These are the ones the UI hits when you&apos;re signed in.
              </p>

              <H3>Project-scoped endpoints</H3>
              <p>
                A small set of endpoints (<code>/api/projects/:id/*</code>) accept a project-level API key. Use this
                for glue scripts that should act on behalf of the project rather than a specific agent.
              </p>
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
                Conductor is admin-password protected. The password is set during installation and changed from
                <em> Settings &rarr; Security &rarr; Change password</em>. After signing in, your browser carries a
                session cookie; the cookie is HttpOnly and SameSite=Lax.
              </p>

              <H3>Session lifetime</H3>
              <Bullets>
                <li>Default timeout is 12 hours sliding — each request renews the cookie.</li>
                <li>Change the timeout in <em>Settings &rarr; General</em>. Maximum is 30 days.</li>
                <li>Changing the password rotates the signing secret, which invalidates every active session.</li>
              </Bullets>

              <Callout tone="amber" title="Multiple admins">
                <p>
                  Current releases have one shared admin password. Per-user accounts with roles are on the 0.4
                  roadmap. Until then, share the password narrowly and rotate whenever someone with access
                  leaves.
                </p>
              </Callout>
            </Section>

            <Section id="help-security-keys" title="Key storage">
              <p>
                All sensitive values — runtime API keys, agent keys, MCP connection tokens — are encrypted at rest. Conductor uses a server-side encryption key stored in an
                environment variable (<code>CONDUCTOR_ENCRYPTION_KEY</code>) or a local KMS endpoint.
              </p>

              <H3>What you see vs. what&apos;s stored</H3>
              <Bullets>
                <li>Full key — shown once at creation or rotation, then never again.</li>
                <li>Preview — the first 6 and last 4 characters, for identification (<code>ab_1234…abcd</code>).</li>
                <li>Hash — stored for lookup.</li>
                <li>Encrypted blob — stored for retrieval when Conductor needs to call out (only HTTP runtimes and MCP connections need to be decrypted at runtime).</li>
              </Bullets>

              <H3>Where the encryption key lives</H3>
              <p>
                Not in the database. If you redeploy with a new encryption key, all stored secrets become
                unrecoverable and must be re-entered. Back up the key whenever you back up the database.
              </p>
            </Section>

            <Section id="help-security-rotation" title="Key rotation">
              <p>
                Rotate early, rotate often.
              </p>
              <Bullets>
                <li><strong>Agent keys</strong> — <em>Settings &rarr; Agents &rarr; [agent] &rarr; Rotate key</em>. The old key becomes invalid the moment the new one is issued — there is no overlap window, so update the agent&apos;s config before you rotate.</li>
                <li><strong>Runtime keys</strong> — <em>Settings &rarr; Runtimes &rarr; [runtime] &rarr; Edit &rarr; Paste new key</em>. Old key is discarded on save.</li>
                <li><strong>Project API key</strong> — <em>Settings &rarr; API Keys &rarr; Rotate</em>. Breaks any external script still using the old key.</li>
                <li><strong>Admin password</strong> — <em>Settings &rarr; Security &rarr; Change password</em>. Invalidates all active sessions.</li>
                <li><strong>Encryption key</strong> — done at the filesystem/env-var level. Requires downtime and a one-time re-key of all encrypted rows; see the <em>Operations</em> section of the README.</li>
              </Bullets>
            </Section>

            {/* ════════════════════════════════════════════════════════════════
                TROUBLESHOOTING
               ════════════════════════════════════════════════════════════════ */}

            <Section id="help-trouble-ws" title="WebSocket shows Offline">
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

            <Section id="help-trouble-stuck" title="A task is stuck">
              <p>
                Symptom: a task sits in <Term>IN_PROGRESS</Term> for hours, no activity, no completion.
              </p>
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

            <Section id="help-faq" title="FAQ">
              <H3>Is Conductor a chat UI?</H3>
              <p>
                No. Conductor dispatches work to agents and tracks the outcomes. If you want to chat with a model
                directly, use that provider&apos;s own client.
              </p>

              <H3>Do I need Docker / Postgres?</H3>
              <p>
                No. Conductor ships with SQLite as the default — zero config. You gain semantic skill search and
                better concurrency with Postgres + pgvector, but everything else works on SQLite.
              </p>

              <H3>Can I run it on my laptop?</H3>
              <p>
                Yes. <code>bun install &amp;&amp; bun run db:push &amp;&amp; bun run dev</code>. You&apos;ll need an
                API key for at least one runtime (Anthropic, OpenAI, OpenRouter, or local Ollama).
              </p>

              <H3>Can multiple people use the same Conductor at the same time?</H3>
              <p>
                Yes. The activity log records who did what, and the WebSocket pushes changes to every open
                browser instantly. There&apos;s one shared admin password today — per-user accounts land in 0.4.
              </p>

              <H3>Does Conductor train the models?</H3>
              <p>
                No. Conductor is a dispatcher. It sends prompts to whatever model your runtime points at. The
                models themselves are run and maintained by their providers (Anthropic, OpenAI, you on Ollama, etc.).
              </p>

              <H3>Can an agent talk to another agent directly?</H3>
              <p>
                Not directly — always through Conductor. This is intentional: having agents communicate only via
                tasks and the chain keeps every hand-off auditable. If you want an agent&apos;s output to feed
                another&apos;s input, build a chain.
              </p>

              <H3>How much does it cost to run?</H3>
              <p>
                Infrastructure: small. A single server and a database. The AI provider bills are the dominant cost;
                set <em>Max cost per step</em> and keep an eye on the Observability dashboard&apos;s cost tile.
              </p>
            </Section>

            <Section id="help-glossary" title="Glossary">
              <dl className="grid grid-cols-1 md:grid-cols-[160px_1fr] gap-x-6 gap-y-3 text-sm">
                {([
                  ['Activity', 'An append-only log of every state change in a project. The audit trail.'],
                  ['Agent', 'A configured worker record — name, runtime, modes, key. Can be HTTP-invoked or run as a daemon.'],
                  ['Artifact', 'A file produced by an agent during a step. Kept against the task.'],
                  ['Attempt', 'One execution of a step. A step can have many attempts if retried.'],
                  ['Automation', 'Internal rules that react to Conductor events (task created, moved, tagged).'],
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
