# Conductor — AI Agent Orchestration Platform

A professional-grade orchestration platform for AI agents with workflow chains, automated dispatch, human verification gates, and real-time updates.

## Features

- **Kanban Board**: 5-column board (Backlog, In Progress, Waiting, Review, Done) with drag-and-drop
- **Workflow Chains**: Multi-step chains with human review gates, DAG edges, and reusable chain templates
- **Agent HTTP API**: Real REST endpoints for AI agents to claim, start, and complete tasks
- **CLI-Style API**: Simple text-based API for shell script integration
- **WebSocket Updates**: Real-time board updates across all connected clients
- **Multi-Project Support**: Create and manage multiple projects
- **Multi-User Accounts**: Named owner/admin/member accounts with role-gated settings and revocable sessions
- **Agent Management**: Create agents with unique API keys
- **Agent Library & Wizard**: Import curated agents, or compose an agent from natural-language requirements via LLM
- **Recurring Tasks**: Instantiate task templates on a daily/weekly/monthly schedule, chains included
- **Triggers & Reactions**: Internal events and Sentry alerts fire Slack, Jira, HTTP, and email reactions
- **MCP Connections**: Per-project MCP servers with tool allowlists and per-tool usage stats
- **Skills Library**: Reusable, versioned knowledge agents can pull in, with semantic search on pgvector
- **Runtime Dashboard**: Live view of daemon hosts, execution sessions, and the step queue
- **Observability & Analytics**: Cross-project KPIs, per-agent dashboards, and per-project cost analytics
- **Dead-Letter Recovery**: Steps that exhaust retries are snapshotted for review and requeue
- **Activity Logging**: Full audit trail of agent actions with level/component filters and JSONL/CSV export
- **Project Export & Import**: Back up or move a project as a secret-free JSON bundle and re-import it as a fresh copy

## Requirements

- Bun 1.3+ and Node.js 20+ (Node is used by the Next.js build)
- Optional: Docker (for PostgreSQL + pgvector — enables semantic skill search)

## Quick Start

### 1. Install Dependencies

```bash
bun install
```

### 2. Setup Database

**SQLite (default — zero config):**
```bash
bun run db:push
```

**PostgreSQL (optional — for semantic search via pgvector):**
```bash
docker compose --profile postgres up -d postgres   # just the pgvector server
# Update .env: DATABASE_URL="postgresql://conductor:conductor_dev@localhost:5432/conductor"
bun run db:push                                     # see ADR-0004 provider caveat in INSTALL.md
```

### 3. Start Development Server

```bash
bun run dev
# or
npm run dev
```

### 4. Open in Browser

Navigate to `http://localhost:3000`

### 5. Create Your First Project

> 📖 **Full walkthrough:** [docs/walkthroughs/first-project-calendar-app.md](docs/walkthroughs/first-project-calendar-app.md)
> takes you from a fresh install to agents building a small calendar app —
> runtime, agents, chains, automation, and where the results land.

Open the board, sign in with the admin password, and create a project from the header. You can choose whether to provision starter agents during project creation.

Optional for local evaluation: use the "Load Demo Data" button from the empty state instead of creating a project manually.

## Deployment

The turnkey production path is Docker — one command brings up the web app plus
the realtime service with a persistent SQLite database on a named volume:

```bash
cp .env.example .env      # set AGENTBOARD_ADMIN_PASSWORD + the two AGENTBOARD_WS_* secrets
docker compose up --build # app on :3000, board-ws on :3003
```

For manual/local production (`bun run build` then `bun run start`), the Postgres
profile, browser-realtime build arg, backups, and the optional daemon workers,
see **[INSTALL.md](INSTALL.md)**. Note: the production standalone server runs
under **Node** (not Bun) and targets **Linux** — on a Windows host use
`bun run dev` for development.

## API Usage

### Get Agent API Key

1. Open the app and click the ⚙️ Settings icon
2. Go to "API Keys" tab
3. Rotate the agent key if you need a fresh secret, then copy it from that response

### CLI-Style API

```bash
# Get next task
curl http://localhost:3000/api/cli \
  -H "Authorization: Bearer YOUR_AGENT_KEY"

# Claim a task
curl -X POST http://localhost:3000/api/cli \
  -H "Authorization: Bearer YOUR_KEY" \
  -H "Content-Type: application/json" \
  -d '{"action":"claim", "task_id":"TASK_ID"}'

# Complete a task
curl -X POST http://localhost:3000/api/cli \
  -H "Authorization: Bearer YOUR_KEY" \
  -H "Content-Type: application/json" \
  -d '{"action":"done", "task_id":"TASK_ID", "output":"shipped"}'
```

### REST API

```bash
# Get agent's tasks
curl http://localhost:3000/api/agent/tasks \
  -H "Authorization: Bearer YOUR_AGENT_KEY"

# Get next available task
curl http://localhost:3000/api/agent/next \
  -H "Authorization: Bearer YOUR_AGENT_KEY"

# Update task (claim, start, progress, complete, review, block)
curl -X PUT "http://localhost:3000/api/agent/tasks/TASK_ID" \
  -H "Authorization: Bearer YOUR_KEY" \
  -H "Content-Type: application/json" \
  -d '{"action":"complete", "output":"Done!"}'
```

### Agent Memory

Agents have two tiers of memory injected into their system prompt:

**Working memory** (automatic) — the 5 most recent completed tasks for this `(agent, project)` pair, formatted as a bullet list. No action needed; it's always injected when the agent's system prompt contains `{{memory.recent}}`.

**Persistent memory** (opt-in) — agents write durable facts, decisions, preferences, and patterns. Retrieval uses embedding similarity against the current task when both `DATABASE_URL` points at Postgres with the `pgvector` extension (see `scripts/init-pgvector.sql`) AND `OPENAI_API_KEY` is set. Falls back to substring match otherwise — this is also the default on SQLite.

```bash
# Write a memory
curl -X POST http://localhost:3000/api/agents/YOUR_AGENT_ID/memories \
  -H "Authorization: Bearer YOUR_AGENT_KEY" \
  -H "Content-Type: application/json" \
  -d '{"category":"fact", "content":"Prod DB is at 10.0.0.5"}'

# List your memories
curl http://localhost:3000/api/agents/YOUR_AGENT_ID/memories \
  -H "Authorization: Bearer YOUR_AGENT_KEY"

# Delete a memory
curl -X DELETE http://localhost:3000/api/agents/YOUR_AGENT_ID/memories/MEMORY_ID \
  -H "Authorization: Bearer YOUR_AGENT_KEY"
```

Categories: `fact | decision | preference | pattern`.
System prompt slots: `{{memory.recent}}` (working) and `{{memory.relevant}}` (top-5 persistent matches against task title/description).

Memories are scoped to `(agent, project)` — an agent can't read/write another agent's memories, and a memory is deleted with its owning agent or project.

Default agents shipped with new projects already reference these slots. **Existing agents from before this feature are not auto-migrated** — edit the agent's system prompt to add `{{memory.recent}}` / `{{memory.relevant}}` to opt in.

## Project Structure

```
├── src/
│   ├── app/
│   │   ├── api/           # API routes
│   │   │   ├── agent/     # Agent HTTP API
│   │   │   ├── cli/       # CLI-style API
│   │   │   ├── tasks/     # Task CRUD
│   │   │   ├── agents/    # Agent CRUD
│   │   │   ├── projects/  # Project CRUD
│   │   │   ├── activity/  # Activity log
│   │   │   └── seed/      # Database seeding
│   │   ├── page.tsx       # Main page
│   │   ├── layout.tsx     # Root layout
│   │   └── globals.css    # Global styles
│   ├── components/ui/     # shadcn/ui components
│   ├── lib/               # Utilities
│   └── hooks/             # React hooks
├── prisma/
│   └── schema.prisma      # Database schema
├── mini-services/
│   └── board-ws/          # WebSocket service
└── public/                # Static assets
```

## Environment Variables

Create a `.env` file:

```env
DATABASE_URL="file:./prisma/dev.db"
# For PostgreSQL + pgvector: DATABASE_URL="postgresql://conductor:conductor_dev@localhost:5432/conductor"
AGENTBOARD_ADMIN_PASSWORD="change-me"
# Optional: separate session salt for admin cookies
AGENTBOARD_ADMIN_SESSION_SECRET="replace-with-a-random-secret"
AGENTBOARD_WS_SECRET="shared-secret-for-realtime-tokens"
AGENTBOARD_WS_INTERNAL_SECRET="shared-secret-for-server-broadcasts"
# Optional if the websocket service is not on localhost:3003
AGENTBOARD_WS_URL="http://127.0.0.1:3003"
# Optional browser websocket URL for deployed clients
NEXT_PUBLIC_AGENTBOARD_WS_URL="http://127.0.0.1:3003"
# Optional comma-separated allowlist for websocket origins
AGENTBOARD_WS_ALLOWED_ORIGINS="http://localhost:3000,http://127.0.0.1:3000"
# Optional: semantic retrieval for memory and skill search
OPENAI_API_KEY=""
# Optional: override the default embedding model
EMBEDDING_MODEL="text-embedding-3-small"
# Optional: path to a local system prompt archive directory (enables /api/prompt-library)
PROMPT_LIBRARY_PATH="/path/to/system_prompts_leaks"
```

The board UI requires sign-in before it can access project management routes. The first login with `AGENTBOARD_ADMIN_PASSWORD` creates the owner account; after that, sign in with account email + password.
API keys are now managed as previews plus rotation:
- Existing legacy plaintext keys can be migrated to hash-only storage from the API Keys tab without changing the secrets agents already use.
- The settings UI shows only a preview for stored keys.
- Rotating a key returns the new raw secret once and immediately invalidates the previous one.

## WebSocket Service (Optional)

Solo local dev works fine without this — the board falls back to manual refresh.
Recommended for shared deployments (live cursors + multi-client board updates).

To start the WebSocket service:

```bash
cd mini-services/board-ws
bun install
bun run dev
```

The WebSocket server runs on port 3003.

Set the same `AGENTBOARD_WS_SECRET` and `AGENTBOARD_WS_INTERNAL_SECRET` for both the Next app and the websocket service. Set `AGENTBOARD_WS_ALLOWED_ORIGINS` explicitly outside local development.

## Tech Stack

- **Framework**: Next.js 16 with App Router
- **Language**: TypeScript
- **Styling**: Tailwind CSS 4
- **UI Components**: shadcn/ui
- **Database**: Prisma ORM with SQLite (default) or PostgreSQL 17 + pgvector
- **Real-time**: Socket.io
- **Search**: Text search (SQLite) or pgvector cosine similarity (PostgreSQL)

## Prompt Archive Browser

AgentBoard can browse a local directory of markdown system prompt templates and use them as a base for new agents.

**Setup:** Set `PROMPT_LIBRARY_PATH` in `.env` to the root of your prompt archive directory:

```
PROMPT_LIBRARY_PATH="/path/to/your/prompt/archive"
```

The archive should contain top-level subdirectory "categories" (e.g. `Anthropic/`, `agents/`, `Google/`), each containing `.md` files with the system prompt content. The first H1 heading becomes the entry title; the first paragraph becomes the description.

**Usage:** In the agent creation modal, click **From Archive** on the Runtime tab to open the archive browser, preview entries, and use one as a base for your agent's system prompt.

## Agent Wizard

The Agent Wizard creates a new agent from natural-language requirements. It searches the prompt archive for relevant templates and uses an LLM to compose a tailored system prompt and agent profile.

**Steps:**
1. **Requirements** — describe what the agent should do, its domain, primary goal, and which LLM runtime to use for composition
2. **Composing** — the wizard searches the archive and calls the selected LLM to generate agent fields
3. **Review & Save** — inspect and edit the generated name, role, personality, and system prompt before saving

**Usage:** Click the **✨ Wizard** button in the sidebar to open the wizard.

### API

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/prompt-library` | GET | List all archive entries grouped by category |
| `/api/prompt-library/[entryId]` | GET | Get full content of one archive entry |
| `/api/agent-wizard/compose` | POST | Compose agent fields from requirements using LLM |

## License

MIT
