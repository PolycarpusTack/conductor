# Walkthrough: Your First Project — a Small Calendar App

A complete, end-to-end scenario: from a fresh Conductor install to agents
producing a working calendar application, cards moving across the board on
their own. ~10 minutes of setup, then the agents work.

---

## The mental model first

Conductor **dispatches prompts to agents and tracks the results as cards,
steps, and artifacts** — it is not a chat UI. Every agent has an *invocation
mode* that decides where the work actually happens:

| Mode | What happens | What you get |
|---|---|---|
| **HTTP** (default) | The server sends each step's composed prompt to the LLM API (your runtime) | Text/code as **step output + artifacts** in the task drawer — you copy results out |
| **DAEMON** | A `conductor-daemon` on your machine runs a terminal tool (e.g. Claude Code) per step | **Real files in a real repo**, with full session capture |

This walkthrough uses **HTTP mode** — zero extra infrastructure, perfect for
a first project. The daemon upgrade is at the end.

---

## Step 1 — Fuel

Put a provider key in `.env`:

```
ANTHROPIC_API_KEY=sk-ant-...
```

Start the app (`bun run dev`), open http://localhost:3000, sign in.

> First login after an upgrade from the shared-password days creates your
> `owner@conductor.local` account automatically — same password, and a toast
> explains it.

## Step 2 — Project

Sidebar → **New Project** → name it `Calendar App`. Keep *create starter
agents* checked — you get a developer / researcher / reviewer trio to start
from.

## Step 3 — Runtime

**Settings → Runtimes → Add**:

- Provider: `Anthropic`
- API key env var: `ANTHROPIC_API_KEY` (Conductor stores the *name*, never
  the key)
- Pick the models you want available.

Hit the **stethoscope button** — it makes a real test call so you know the
runtime works *before* any task depends on it.

## Step 4 — Agents

**Settings → Agents**: edit each starter agent → assign the runtime + a
model → toggle **Active**.

> ⚠️ **The #1 "nothing happens" cause:** steps only dispatch to agents that
> are *active* AND have a *runtime*. An agent missing either is silently
> skipped by the dispatcher.

Optional: **Import from Library** brings in ~100 specialist agents
(DDD coaches, reviewers, security/SRE advisors, planning facilitators) plus
~27 ready-made workflow chains. Imports land **inactive** — activate just
the ones you'll use and give them the runtime.

## Step 5 — Create the work

Two good options:

### Option A — let Conductor plan it

Create a task: **"Plan the calendar app"**, description = your idea:

> Month and week views, create/edit/delete events, event colors, local
> storage persistence, React + Vite, no backend.

Assign **backlog-builder** (library → Orchestration). It dispatches
immediately; its step output in the task drawer is a structured story
backlog. Create a card per story from it.

### Option B — one chain task (recommended first run)

**Create Task** → title `Build calendar MVP`, paste the requirements into
the description, then build the **Workflow Chain**:

| # | Mode | Agent | Instructions |
|---|---|---|---|
| 1 | `analyze` | researcher | Produce the component breakdown and data model |
| 2 | `develop` | developer | Implement the calendar per the previous step's design |
| 3 | `review` | reviewer | Review the implementation for bugs and gaps |
| 4 | `human` | — (label: *Your sign-off*) | |

Or pick an imported template (e.g. **Quick Prototype Development**) from the
chain dropdown — its steps arrive pre-assigned to the matching library
agents by role.

## Step 6 — Start the engine

**Settings → Automation → Start** (or set mode *Always On*).

This is the dispatcher. Without it, cards sit still — the status pill must
be green: *"Polling every 10s — dispatching active steps to agents."*

## Step 7 — Watch it run

- Chain tasks start **IN_PROGRESS** automatically.
- Each step's card shows the running agent; steps **auto-advance**, and each
  step receives the previous step's output as context.
- Click the card → the **task drawer** shows the rendered prompt, live
  output, artifacts, and the evidence panel per step.
- The `human` gate parks the task in **WAITING** until you approve it in the
  drawer — then it lands in **DONE**.

## Step 8 — Collect the code

The develop step's output/artifacts in the task drawer contain the
implementation. Copy it into your repo.

---

## The real-files upgrade: daemon mode

When copy-paste stops being acceptable, switch the developer agent to
**DAEMON** mode and run `mini-services/conductor-daemon` on your machine:

1. Register once (admin-gated): `bun index.ts --register` — prints a
   one-time `CONDUCTOR_DAEMON_TOKEN`, and registers your machine as a
   durable **Host**.
2. Run it with the token; it heartbeats, polls for steps leased to
   DAEMON-mode agents, and reports sessions you can watch in the Runtime
   Dashboard's Hosts/Sessions tabs.
3. **Safety default:** the reference daemon is a no-op echo runner until you
   set a `commandTemplate` on the runtime config (e.g. launching Claude
   Code) — wiring it to a real workspace is the deliberate, explicit step.

---

## Power-ups that compose with this

- **Automation rules** (Settings → Integrations): trigger on `task-created`
  with filter `tag equals backend` → internal action `task:assign` — new
  cards self-assign.
- **Task templates** (Settings → Templates): save "Bug report" or "Feature"
  forms; `{date}` in title patterns expands at pick time.
- **Recurring tasks** (Settings → Automation): instantiate a task template
  daily/weekly/monthly — attached chains start with agents resolved by role.
- **Time-based rules**: auto-archive DONE tasks after N days; escalate human
  gates that wait too long.

## If something doesn't move

1. `bun run doctor` — names the missing link (key, runtime, agents,
   automation, WS, daemon).
2. Task drawer → step output viewer — the rendered prompt answers 90% of
   "why did it do that".
3. Settings → Activity — warnings, dead letters, and who/what did each
   action.
4. Press `?` in the app — the built-in help has a "first 30 minutes" guide
   that walks this same path.
