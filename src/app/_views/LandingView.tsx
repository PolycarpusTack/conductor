'use client'

import { Button } from '@/components/ui/button'
import {
  ArrowRight,
  Menu,
  X,
  Bot,
  Sparkles,
  GitBranch,
  Eye,
  Settings,
  Copy,
  Activity,
  Key,
} from 'lucide-react'

interface LandingViewProps {
  setView: (v: 'landing' | 'board' | 'runtime' | 'skills' | 'help') => void
  sidebarOpen: boolean
  setSidebarOpen: (open: boolean) => void
}

export function LandingView({ setView, sidebarOpen, setSidebarOpen }: LandingViewProps) {
  return (
    <div className="min-h-screen bg-background dark">
      {/* Header */}
      <header className="fixed top-0 left-0 right-0 z-50 bg-transparent">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-6">
          <a className="flex items-center gap-2" href="#">
            <img src="/icon.png" alt="Conductor" className="h-6 w-6 rounded-md" />
            <span className="text-sm font-semibold tracking-tight font-heading">Conductor</span>
          </a>
          <nav className="hidden items-center gap-8 md:flex">
            <a href="#features" className="text-[13px] text-muted-foreground/60 transition-colors hover:text-foreground">
              Features
            </a>
            <a href="#api" className="text-[13px] text-muted-foreground/60 transition-colors hover:text-foreground">
              API
            </a>
            <a href="#how-it-works" className="text-[13px] text-muted-foreground/60 transition-colors hover:text-foreground">
              How it works
            </a>
          </nav>
          <div className="hidden items-center gap-4 md:flex">
            <Button
              className="rounded-lg gradient-cobalt px-3.5 py-1.5 text-[13px] font-medium text-white hover:shadow-glow-cobalt transition-shadow"
              onClick={() => setView('board')}
            >
              Launch Board
            </Button>
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="md:hidden"
            onClick={() => setSidebarOpen(!sidebarOpen)}
          >
            {sidebarOpen ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
          </Button>
        </div>
      </header>

      {/* Mobile menu */}
      {sidebarOpen && (
        <div className="fixed inset-0 z-40 bg-background/95 backdrop-blur-sm md:hidden pt-14">
          <nav className="flex flex-col items-center gap-6 p-8">
            <a href="#features" className="text-lg text-muted-foreground" onClick={() => setSidebarOpen(false)}>
              Features
            </a>
            <a href="#api" className="text-lg text-muted-foreground" onClick={() => setSidebarOpen(false)}>
              API
            </a>
            <Button
              className="w-full rounded-lg gradient-cobalt text-white"
              onClick={() => { setSidebarOpen(false); setView('board') }}
            >
              Launch Board
            </Button>
          </nav>
        </div>
      )}

      <main>
        {/* Hero Section */}
        <section className="relative overflow-hidden pt-28 pb-16 md:pt-36 md:pb-24">
          <div className="pointer-events-none absolute inset-0 opacity-[0.015]" style={{
            backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='1'/%3E%3C/svg%3E")`
          }} />
          <div className="pointer-events-none absolute right-0 top-16 h-[500px] w-[500px] rounded-full bg-[var(--cobalt)]/[0.06] blur-[100px]" />
          <div className="pointer-events-none absolute left-1/4 top-48 h-[300px] w-[300px] rounded-full bg-[var(--neon-green)]/[0.03] blur-[80px]" />

          <div className="relative mx-auto max-w-6xl px-6">
            <div className="text-center max-w-3xl mx-auto">
              <h1 className="text-4xl font-bold tracking-tight font-heading sm:text-5xl lg:text-[3.5rem] lg:leading-[1.1]">
                Orchestrate AI agents.
                <br />
                <span className="text-[var(--text-2)]">Automate workflows.</span>
              </h1>
              <p className="mt-6 max-w-2xl mx-auto text-base leading-relaxed text-muted-foreground sm:text-[17px]">
                Create agents, define workflow chains, and let Conductor dispatch work across AI providers — with human verification gates built in.
              </p>
              <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row sm:gap-4">
                <Button
                  className="group inline-flex items-center gap-2 rounded-lg gradient-cobalt px-5 py-2.5 text-sm font-semibold text-white hover:shadow-glow-cobalt transition-shadow"
                  onClick={() => setView('board')}
                >
                  Launch Board
                  <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />
                </Button>
                <a
                  href="#how-it-works"
                  className="inline-flex items-center gap-2 text-sm text-muted-foreground transition-colors hover:text-foreground"
                >
                  See how it works
                  <span className="text-[10px]">↓</span>
                </a>
              </div>
            </div>
          </div>
        </section>

        {/* How It Works */}
        <section id="how-it-works" className="relative py-24 md:py-32">
          <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-border to-transparent" />

          <div className="mx-auto max-w-6xl px-6">
            <div className="text-center mb-16">
              <h2 className="text-3xl font-bold tracking-tight font-heading sm:text-4xl">How it works</h2>
              <p className="mt-4 text-muted-foreground max-w-2xl mx-auto">
                From agent creation to shipped output in four steps.
              </p>
            </div>

            <div className="grid gap-6 md:grid-cols-4">
              {[
                {
                  step: "1",
                  title: "Create Agents",
                  description: "Define agents with roles, system prompts, and AI provider connections",
                  color: "var(--cobalt)",
                  bgClass: "bg-[var(--cobalt)]/10",
                  textClass: "text-[var(--cobalt)]",
                  icon: <Bot className="h-5 w-5" />,
                },
                {
                  step: "2",
                  title: "Build Workflows",
                  description: "Chain steps together: analyze, verify, develop, human review",
                  color: "var(--neon-green)",
                  bgClass: "bg-[var(--neon-green)]/10",
                  textClass: "text-[var(--neon-green)]",
                  icon: <GitBranch className="h-5 w-5" />,
                },
                {
                  step: "3",
                  title: "Dispatch & Execute",
                  description: "Conductor sends work to the right AI model automatically",
                  color: "var(--op-teal)",
                  bgClass: "bg-[var(--op-teal)]/10",
                  textClass: "text-[var(--op-teal)]",
                  icon: <Sparkles className="h-5 w-5" />,
                },
                {
                  step: "4",
                  title: "Review & Ship",
                  description: "Human gates pause the chain. Approve, then auto-continue",
                  color: "var(--op-amber)",
                  bgClass: "bg-[var(--op-amber)]/10",
                  textClass: "text-[var(--op-amber)]",
                  icon: <Eye className="h-5 w-5" />,
                },
              ].map((item, i) => (
                <div key={item.step} className="relative flex flex-col items-center text-center">
                  {i < 3 && (
                    <div className="pointer-events-none absolute right-0 top-10 hidden translate-x-1/2 md:block">
                      <ArrowRight className="h-4 w-4 text-muted-foreground/30" />
                    </div>
                  )}
                  <div className={`mb-4 flex h-12 w-12 items-center justify-center rounded-xl ${item.bgClass} ${item.textClass}`}>
                    {item.icon}
                  </div>
                  <span className={`mb-1 text-xs font-semibold uppercase tracking-wider ${item.textClass}`}>
                    Step {item.step}
                  </span>
                  <h3 className="text-lg font-semibold font-heading mb-2">{item.title}</h3>
                  <p className="text-sm text-muted-foreground">{item.description}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Features Grid */}
        <section id="features" className="relative py-24 md:py-32">
          <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-border to-transparent" />
          <div className="pointer-events-none absolute left-0 bottom-24 h-[400px] w-[400px] rounded-full bg-[var(--cobalt)]/[0.06] blur-[100px]" />

          <div className="mx-auto max-w-6xl px-6">
            <p className="mb-16 text-xs uppercase tracking-[0.2em] text-muted-foreground/40">Platform capabilities</p>

            <div className="grid gap-8 md:grid-cols-2 lg:grid-cols-3">
              <div className="rounded-xl border border-border/30 bg-card p-6">
                <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-lg bg-[var(--cobalt)]/10">
                  <GitBranch className="h-6 w-6 text-[var(--cobalt)]" />
                </div>
                <h3 className="text-lg font-semibold mb-2">Workflow Chains</h3>
                <p className="text-sm text-muted-foreground">
                  Multi-step agent workflows with automatic handoffs. Support investigation, bug fix, documentation — all as templates.
                </p>
              </div>

              <div className="rounded-xl border border-border/30 bg-card p-6">
                <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-lg bg-violet-500/10">
                  <Settings className="h-6 w-6 text-violet-400" />
                </div>
                <h3 className="text-lg font-semibold mb-2">Multi-Runtime</h3>
                <p className="text-sm text-muted-foreground">
                  Claude for coding, GPT for analysis, webhooks for custom systems. Each agent picks its own provider and model.
                </p>
              </div>

              <div className="rounded-xl border border-border/30 bg-card p-6">
                <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-lg bg-[var(--op-amber)]/10">
                  <Eye className="h-6 w-6 text-[var(--op-amber)]" />
                </div>
                <h3 className="text-lg font-semibold mb-2">Human Gates</h3>
                <p className="text-sm text-muted-foreground">
                  Insert human verification at any point. Tasks pause in WAITING until approved.
                </p>
              </div>

              <div className="rounded-xl border border-border/30 bg-card p-6">
                <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-lg bg-[var(--neon-green)]/10">
                  <Sparkles className="h-6 w-6 text-[var(--neon-green)]" />
                </div>
                <h3 className="text-lg font-semibold mb-2">Agent Modes</h3>
                <p className="text-sm text-muted-foreground">
                  Analyze, verify, develop, review, draft — agents behave differently per mode with scoped permissions.
                </p>
              </div>

              <div className="rounded-xl border border-border/30 bg-card p-6">
                <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-lg bg-[var(--op-teal)]/10">
                  <Copy className="h-6 w-6 text-[var(--op-teal)]" />
                </div>
                <h3 className="text-lg font-semibold mb-2">Chain Templates</h3>
                <p className="text-sm text-muted-foreground">
                  Pre-built workflow patterns. Pick a template, assign agents, go.
                </p>
              </div>

              <div className="rounded-xl border border-border/30 bg-card p-6">
                <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-lg bg-emerald-500/10">
                  <Activity className="h-6 w-6 text-emerald-400" />
                </div>
                <h3 className="text-lg font-semibold mb-2">Real-time Board</h3>
                <p className="text-sm text-muted-foreground">
                  5-column Kanban with live updates. See chain progress on every task card.
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* API Section */}
        <section id="api" className="relative py-24 md:py-32">
          <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-border to-transparent" />

          <div className="mx-auto max-w-6xl px-6">
            <div className="text-center mb-16">
              <h2 className="text-3xl font-bold tracking-tight font-heading sm:text-4xl">Agent HTTP API</h2>
              <p className="mt-4 text-muted-foreground max-w-2xl mx-auto">
                Connect your AI agents via simple HTTP endpoints. The dispatch system handles routing to the right provider automatically.
              </p>
            </div>

            <div className="grid gap-8 md:grid-cols-3">
              {/* CLI API */}
              <div className="rounded-xl border border-border/30 bg-card p-6">
                <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
                  <Key className="h-5 w-5 text-[var(--cobalt)]" /> CLI-Style API
                </h3>
                <div className="space-y-4">
                  <div className="rounded-lg bg-muted/30 p-3 font-mono text-xs">
                    <div className="text-muted-foreground"># Get next task</div>
                    <div>GET /api/cli</div>
                    <div className="text-blue-400">Authorization: Bearer YOUR_KEY</div>
                  </div>
                  <div className="rounded-lg bg-muted/30 p-3 font-mono text-xs">
                    <div className="text-muted-foreground"># Claim and start task</div>
                    <div>POST /api/cli</div>
                    <div className="text-blue-400">Authorization: Bearer YOUR_KEY</div>
                    <div className="text-foreground/70">{"{"} &quot;action&quot;: &quot;claim&quot;, &quot;task_id&quot;: &quot;...&quot; {"}"}</div>
                  </div>
                </div>
              </div>

              {/* REST API */}
              <div className="rounded-xl border border-border/30 bg-card p-6">
                <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
                  <Activity className="h-5 w-5 text-emerald-400" /> REST API
                </h3>
                <div className="space-y-4">
                  <div className="rounded-lg bg-muted/30 p-3 font-mono text-xs">
                    <div className="text-muted-foreground"># Get agent&apos;s tasks</div>
                    <div>GET /api/agent/tasks</div>
                    <div className="text-blue-400">Authorization: Bearer AGENT_KEY</div>
                  </div>
                  <div className="rounded-lg bg-muted/30 p-3 font-mono text-xs">
                    <div className="text-muted-foreground"># Update task with action</div>
                    <div>PUT /api/agent/tasks/:id</div>
                    <div className="text-foreground/70">{"{"} &quot;action&quot;: &quot;complete&quot;, &quot;output&quot;: &quot;...&quot; {"}"}</div>
                  </div>
                </div>
              </div>

              {/* Chain Dispatch API */}
              <div className="rounded-xl border border-border/30 bg-card p-6">
                <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
                  <GitBranch className="h-5 w-5 text-[var(--op-teal)]" /> Chain Dispatch
                </h3>
                <div className="space-y-4">
                  <div className="rounded-lg bg-muted/30 p-3 font-mono text-xs">
                    <div className="text-muted-foreground"># Create a task with a chain</div>
                    <div>POST /api/tasks</div>
                    <div className="text-blue-400">Authorization: Bearer SCOPED_KEY</div>
                    <div className="text-foreground/70">{"{"} &quot;title&quot;: &quot;...&quot;, &quot;projectId&quot;: &quot;...&quot;, &quot;steps&quot;: [{"{"} &quot;mode&quot;: &quot;develop&quot;, &quot;agentId&quot;: &quot;...&quot; {"}"}] {"}"}</div>
                  </div>
                  <div className="rounded-lg bg-muted/30 p-3 font-mono text-xs">
                    <div className="text-muted-foreground"># Approve a human review gate</div>
                    <div>PUT /api/tasks/:id/steps/:stepId</div>
                    <div className="text-foreground/70">{"{"} &quot;action&quot;: &quot;review&quot;, &quot;decision&quot;: &quot;approved&quot; {"}"}</div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* CTA */}
        <section className="relative py-24 md:py-32">
          <div className="pointer-events-none absolute right-1/4 top-12 h-[300px] w-[300px] rounded-full bg-[var(--cobalt)]/[0.06] blur-[100px]" />
          <div className="mx-auto max-w-6xl px-6 text-center">
            <h2 className="text-3xl font-bold tracking-tight font-heading sm:text-4xl">
              Ready to orchestrate?
            </h2>
            <p className="mt-4 text-muted-foreground max-w-lg mx-auto">
              Create agents, build workflow chains, and let Conductor handle the dispatch.
            </p>
            <Button
              className="mt-8 group inline-flex items-center gap-2 rounded-lg gradient-cobalt px-6 py-3 text-sm font-semibold text-white hover:shadow-glow-cobalt transition-shadow"
              onClick={() => setView('board')}
            >
              Launch Board
              <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
            </Button>
          </div>
        </section>
      </main>

      {/* Footer */}
      <footer className="border-t border-border/20 py-8">
        <div className="mx-auto max-w-6xl px-6 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <img src="/icon.png" alt="Conductor" className="h-5 w-5 rounded" />
            <span className="text-xs text-muted-foreground font-heading">Conductor</span>
          </div>
          <p className="text-xs text-muted-foreground/40">
            Agent orchestration platform
          </p>
        </div>
      </footer>
    </div>
  )
}
