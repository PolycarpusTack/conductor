# Conductor — AI Agent Orchestration Platform

A professional-grade orchestration platform for AI agents with workflow chains, automated dispatch, human verification gates, and real-time updates.

## Features

- **Kanban Board**: 4-column board (Backlog, In Progress, Review, Done) with drag-and-drop
- **Agent HTTP API**: Real REST endpoints for AI agents to claim, start, and complete tasks
- **CLI-Style API**: Simple text-based API for shell script integration
- **WebSocket Updates**: Real-time board updates across all connected clients
- **Multi-Project Support**: Create and manage multiple projects
- **Agent Management**: Create agents with unique API keys
- **Activity Logging**: Full audit trail of agent actions

## Requirements

- Node.js 18+ or Bun
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
docker compose up -d
# Update .env: DATABASE_URL="postgresql://conductor:conductor_dev@localhost:5432/conductor"
bun run db:push
```

### 4. Start Development Server

```bash
bun run dev
# or
npm run dev
```

### 5. Open in Browser

Navigate to `http://localhost:3000`

### 6. Create Your First Project

Open the board, sign in with the admin password, and create a project from the header. You can choose whether to provision starter agents during project creation.

Optional for local evaluation: use the "Load Demo Data" button from the empty state instead of creating a project manually.

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
```

The board UI now requires the admin password before it can access project management routes.
API keys are now managed as previews plus rotation:
- Existing legacy plaintext keys can be migrated to hash-only storage from the API Keys tab without changing the secrets agents already use.
- The settings UI shows only a preview for stored keys.
- Rotating a key returns the new raw secret once and immediately invalidates the previous one.

## WebSocket Service (Optional)

For real-time updates, start the WebSocket service:

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

## License

MIT
# conductor
