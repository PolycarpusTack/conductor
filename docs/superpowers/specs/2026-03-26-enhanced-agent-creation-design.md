# Enhanced Agent Creation & Task Workflow Chains

**Date:** 2026-03-26
**Status:** Design reviewed, issues resolved (v3 — Settings-based configuration)

## Summary

Evolve AgentBoard from a passive task board into an active agent orchestrator. Two main changes:

1. **Enhanced Agent Creation** — agents become reusable identities with runtime configs, system prompts, model selection, and optional MCP connections
2. **Task Workflow Chains** — tasks can define multi-step chains with agent handoffs, a new WAITING column, and per-step permissions

## Problem

Today, an agent in AgentBoard is just a name, emoji, color, and description. There's no way to:
- Define what an agent is capable of or how it behaves
- Assign different AI providers/models per agent
- Create multi-step workflows with automatic handoffs between agents
- Include human verification checkpoints in agent workflows

## Design

### Part 0: Project-Level Settings (Modes, Runtimes, MCP Connections)

Configuration is managed in Settings, not inline during agent creation. This separates infrastructure setup (done once by an admin) from agent creation (done by anyone).

#### New Settings Tabs

Settings gains three new tabs alongside the existing General, Agents, API, Activity:

| Tab | Purpose | Stored as |
|-----|---------|-----------|
| **Modes** | Define agent operating modes with labels, colors, default instructions | `ProjectMode` model |
| **Runtimes** | Configure AI providers with model lists and API key env var references | `ProjectRuntime` model |
| **MCP Connections** | Configure available MCPs with endpoints and scopes | `ProjectMcpConnection` model |
| **Templates** | Chain templates (already defined in Part 4) | `ChainTemplate` model |

#### Schema: Project Configuration Models

```prisma
model ProjectMode {
  id            String   @id @default(cuid())
  projectId     String
  project       Project  @relation(fields: [projectId], references: [id], onDelete: Cascade)
  name          String   // "analyze" | "verify" | "develop" | "review" | "draft" | "human" | custom
  label         String   // "Analyze" — display name
  color         String   @default("#60A5FA")
  icon          String?  // optional emoji
  instructions  String?  // Default instructions injected when this mode is used
  createdAt     DateTime @default(now())

  @@unique([projectId, name])
}

model ProjectRuntime {
  id            String   @id @default(cuid())
  projectId     String
  project       Project  @relation(fields: [projectId], references: [id], onDelete: Cascade)
  adapter       String   // "anthropic" | "webhook" | "openai" | "z-ai" | "github-copilot"
  name          String   // Display name: "Anthropic — Claude", "Our Webhook"
  models        String   // JSON array: [{id: "claude-sonnet-4", name: "Claude Sonnet 4", tier: "balanced"}, ...]
  apiKeyEnvVar  String?  // e.g., "ANTHROPIC_API_KEY" — reads from process.env at dispatch
  endpoint      String?  // For webhook adapter: the URL to POST to
  config        String?  // JSON: additional adapter-specific config (temperature defaults, etc.)
  available     Boolean  @default(true)
  createdAt     DateTime @default(now())

  @@unique([projectId, adapter, name])
}

model ProjectMcpConnection {
  id            String   @id @default(cuid())
  projectId     String
  project       Project  @relation(fields: [projectId], references: [id], onDelete: Cascade)
  name          String   // "GitHub — acme/platform"
  type          String   // "github" | "jira" | "slack" | "confluence" | "postgres" | "custom"
  icon          String?  // optional emoji
  endpoint      String?  // MCP server endpoint
  config        String?  // JSON: connection-specific config
  scopes        String?  // JSON array: available scopes/permissions
  createdAt     DateTime @default(now())
}
```

**Reciprocal relations on Project model:**
```prisma
model Project {
  // ... existing fields
  modes             ProjectMode[]
  runtimes          ProjectRuntime[]
  mcpConnections    ProjectMcpConnection[]
  chainTemplates    ChainTemplate[]
}
```

#### Pre-built Modes (seeded on project creation)

| Name | Label | Color | Default Instructions |
|------|-------|-------|---------------------|
| `analyze` | Analyze | `#60A5FA` (blue) | "Investigate thoroughly. Gather evidence. Report findings with confidence levels." |
| `verify` | Verify | `#F59E0B` (amber) | "Read-only verification. Check if the proposed solution is valid. Do NOT make changes." |
| `develop` | Develop | `#4ADE80` (green) | "Implement the solution. Write code, run tests, document changes." |
| `review` | Review | `#2DD4BF` (teal) | "Review the output from the previous step for quality, correctness, and completeness." |
| `draft` | Draft | `#A78BFA` (purple) | "Create initial content. Focus on structure and completeness over polish." |
| `human` | Human Review | `#9BAAC4` (gray) | — (no AI instructions, human step) |

Users can edit these defaults and add custom modes (e.g., "triage", "translate", "summarize").

#### API Endpoints for Settings

```
GET    /api/projects/[id]/modes              — list modes
POST   /api/projects/[id]/modes              — create mode
PUT    /api/projects/[id]/modes/[modeId]     — update mode
DELETE /api/projects/[id]/modes/[modeId]     — delete mode

GET    /api/projects/[id]/runtimes           — list runtimes
POST   /api/projects/[id]/runtimes           — create runtime
PUT    /api/projects/[id]/runtimes/[rid]     — update runtime
DELETE /api/projects/[id]/runtimes/[rid]     — delete runtime

GET    /api/projects/[id]/mcp-connections           — list MCPs
POST   /api/projects/[id]/mcp-connections           — create MCP
PUT    /api/projects/[id]/mcp-connections/[cid]     — update MCP
DELETE /api/projects/[id]/mcp-connections/[cid]     — delete MCP
```

All require admin session.

### Part 1: Enhanced Agent Model

#### Schema Changes

Add these fields to the `Agent` model:

```prisma
model Agent {
  // ... existing fields (id, name, emoji, color, description, apiKey*, projectId, etc.)

  // New fields
  role            String?   // "developer" | "researcher" | "writer" | "support" | "qa" | "analyst" | custom
  capabilities    String?   // JSON array: ["python", "code-review", "web-research"]
  maxConcurrent   Int       @default(1)

  // Modes — which modes this agent supports, with per-mode prompt instructions
  supportedModes  String?   // JSON array of mode names: ["analyze", "verify", "develop"]
  modeInstructions String?  // JSON object: {"verify": "Read-only. Do NOT make changes.", "develop": "Implement the fix..."}

  // Runtime — references a ProjectRuntime configured in Settings
  runtimeId       String?   // FK to ProjectRuntime
  runtimeModel    String?   // Selected model ID from the runtime's model list
  systemPrompt    String?   // The agent's system prompt, with {{variable}} placeholders

  // MCP connections — references ProjectMcpConnections configured in Settings
  mcpConnectionIds String?  // JSON array of ProjectMcpConnection IDs: ["cid1", "cid2"]

  // Reciprocal relation for TaskStep
  taskSteps       TaskStep[] @relation("TaskStepAgent")
}
```

**Notes:**
- `capabilities`, `supportedModes`, `modeInstructions`, and `mcpConnectionIds` use JSON strings (SQLite doesn't have native JSON columns)
- `runtimeId` and `runtimeModel` are nullable — an agent without a runtime works in passive/polling mode (backwards compatible)
- `supportedModes` lists which modes (from project Settings) this agent can be assigned to in chain steps
- `modeInstructions` provides per-mode prompt additions (e.g., "verify" mode appends "Read-only. Do NOT make changes." to the system prompt)
- `systemPrompt` supports `{{variable}}` placeholders replaced at dispatch time (see Part 8), including `{{mode.instructions}}` which resolves to the active mode's instructions
- **API key storage:** Managed on the ProjectRuntime in Settings (via `apiKeyEnvVar`), never on the agent directly. The dispatch system reads `process.env[runtime.apiKeyEnvVar]` at dispatch time.

#### maxConcurrent Enforcement

Before dispatching a step to an agent, the dispatch system checks:
```typescript
const activeCount = await db.taskStep.count({
  where: { agentId: agent.id, status: 'active' }
})
if (activeCount >= agent.maxConcurrent) {
  // Leave step as "pending", check again when another step completes
}
```

#### Zod Validation Updates

Add to `contracts.ts`:

```typescript
const agentRoleSchema = z.enum([
  'developer', 'researcher', 'writer', 'support', 'qa', 'analyst', 'custom'
])

// Extend createAgentSchema
export const createAgentSchema = z.object({
  name: z.string().trim().min(1).max(120),
  emoji: z.string().trim().min(1).max(16).optional(),
  color: colorSchema.optional(),
  description: trimmedOptionalString,
  projectId: z.string().trim().min(1),
  // New fields
  role: agentRoleSchema.optional(),
  capabilities: z.array(z.string().trim().max(60)).max(20).optional(),
  maxConcurrent: z.number().int().min(1).max(10).optional(),
  supportedModes: z.array(z.string().trim().max(60)).max(20).optional(),
  modeInstructions: z.record(z.string().max(5000)).optional(),
  runtimeId: z.string().trim().min(1).optional(),    // references ProjectRuntime.id
  runtimeModel: z.string().trim().max(120).optional(),
  systemPrompt: z.string().max(10000).optional(),
  mcpConnectionIds: z.array(z.string().trim().min(1)).max(10).optional(), // references ProjectMcpConnection.id[]
})

// Extend updateAgentSchema
export const updateAgentSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  emoji: z.string().trim().min(1).max(16).optional(),
  color: colorSchema.optional(),
  description: trimmedOptionalString,
  role: agentRoleSchema.optional().nullable(),
  capabilities: z.array(z.string().trim().max(60)).max(20).optional().nullable(),
  maxConcurrent: z.number().int().min(1).max(10).optional(),
  supportedModes: z.array(z.string().trim().max(60)).max(20).optional().nullable(),
  modeInstructions: z.record(z.string().max(5000)).optional().nullable(),
  runtimeId: z.string().trim().min(1).optional().nullable(),
  runtimeModel: z.string().trim().max(120).optional().nullable(),
  systemPrompt: z.string().max(10000).optional().nullable(),
  mcpConnectionIds: z.array(z.string().trim().min(1)).max(10).optional().nullable(),
}).refine((v) => Object.keys(v).length > 0, 'Provide at least one field')

// Project settings schemas
export const createProjectModeSchema = z.object({
  name: z.string().trim().min(1).max(60),
  label: z.string().trim().min(1).max(120),
  color: colorSchema.optional(),
  icon: z.string().max(16).optional(),
  instructions: z.string().max(5000).optional(),
})

export const createProjectRuntimeSchema = z.object({
  adapter: z.enum(['anthropic', 'openai', 'z-ai', 'github-copilot', 'webhook']),
  name: z.string().trim().min(1).max(120),
  models: z.array(z.object({
    id: z.string(),
    name: z.string(),
    tier: z.string().optional(),
  })).min(1),
  apiKeyEnvVar: z.string().max(120).optional(),
  endpoint: z.string().url().optional(),
  config: z.record(z.unknown()).optional(),
})

export const createProjectMcpSchema = z.object({
  name: z.string().trim().min(1).max(120),
  type: z.string().trim().min(1).max(60),
  icon: z.string().max(16).optional(),
  endpoint: z.string().max(500).optional(),
  config: z.record(z.unknown()).optional(),
  scopes: z.array(z.string()).optional(),
})
```

All new fields are optional — existing agent creation flow continues to work.

### Part 2: Create Agent Modal (3-Tab Design)

Replaces the current simple dialog (`sm:max-w-[400px]`, 4 fields) with a wider 3-tab modal (`sm:max-w-[640px]`).

**Extracted as a separate component:** `src/components/agent-creation-modal.tsx`

#### Tab 1: Identity
- **Name** + **Emoji** (side by side, same as today)
- **Role** — clickable chip selector: Developer, Researcher, Writer, Support, QA, Analyst, + Custom
- **Mission / Description** — textarea (same as today's description, relabeled)
- **Capabilities** — tag input with add/remove
- **Supported Modes** — multi-select from modes configured in **Settings > Modes**. Each selected mode shows an optional instructions field for per-mode prompt additions.
- **Max Concurrent Tasks** — number input
- **Color** — color dot picker (same as today)

#### Tab 2: Runtime
- **Runtime** — dropdown from runtimes configured in **Settings > Runtimes**. If none configured, shows "Configure a runtime in Settings first" link.
- **Model** — dropdown filtered by models available on the selected runtime
- **System Prompt** — code-editor-style textarea with:
  - Token count display
  - Template selector dropdown (pre-built prompts for each role)
  - `{{variable}}` placeholder support, including `{{mode.instructions}}`
  - Edit/Preview toggle

#### Tab 3: Connections (optional)
- **MCP Connections** — toggle list from connections configured in **Settings > MCP Connections**. If none configured, shows "Configure connections in Settings first" link.
- Info callout: "No connections required. MCPs expand what the agent can access autonomously."
- Per-connection: icon, name, detail, status badge (Connected / + Connect)

#### UI Placement
- **Sidebar button:** Full-width "Create Agent" button at bottom of the left sidebar (below agent list, full sidebar width)
- **Settings > Agents tab:** Existing "Add Agent" button continues to work
- **Header:** Agent avatars in header bar (existing) — no change
- Created agents appear in the sidebar agent list immediately

#### Agent API Read Path

Update `GET /api/agents` and `GET /api/agents/[id]` select clauses to include new fields:
```typescript
select: {
  // ...existing fields
  role: true,
  capabilities: true,
  maxConcurrent: true,
  runtime: true,
  runtimeModel: true,
  systemPrompt: true,
  // runtimeConfig excluded from list view (contains env var names)
  // mcpConnections excluded from list view (verbose)
}
```

Detail view (`GET /api/agents/[id]`) includes all fields. List view excludes `runtimeConfig` and `mcpConnections` for payload size.

### Part 3: Task Workflow Chains

#### New Model: TaskStep

```prisma
model TaskStep {
  id            String    @id @default(cuid())
  taskId        String
  task          Task      @relation(fields: [taskId], references: [id], onDelete: Cascade)
  order         Int
  agentId       String?
  agent         Agent?    @relation("TaskStepAgent", fields: [agentId], references: [id], onDelete: SetNull)
  humanLabel    String?   // "Tech Lead", "Product Manager" — for human steps
  mode          String    // "analyze" | "verify" | "develop" | "review" | "human" | custom
  instructions  String?   // Step-specific instructions beyond the agent's system prompt
  autoContinue  Boolean   @default(true)  // Auto-dispatch next step on completion
  status        String    @default("pending") // "pending" | "active" | "done" | "failed" | "skipped"
  output        String?   // Result of this step
  error         String?   // Error message if status is "failed"
  startedAt     DateTime?
  completedAt   DateTime?
  createdAt     DateTime  @default(now())

  @@unique([taskId, order])
}
```

**Reciprocal relation on Task model:**
```prisma
model Task {
  // ... existing fields
  steps         TaskStep[]
}
```

#### TaskStatus Enum Change

```prisma
enum TaskStatus {
  BACKLOG
  IN_PROGRESS
  WAITING       // NEW — between chain steps, awaiting next assignee
  REVIEW
  DONE
}
```

**Status lifecycle for chained tasks:**
- `BACKLOG` → first step activated → `IN_PROGRESS`
- Step completes → `WAITING` (between steps)
- Next step activates → `IN_PROGRESS`
- Final step completes → `DONE`
- If any step mode is "human" or `autoContinue` is false → stays in `WAITING` until human triggers

#### TaskStep Zod Schema

```typescript
const taskStepSchema = z.object({
  agentId: z.string().trim().min(1).optional().nullable(),
  humanLabel: z.string().trim().max(120).optional(),
  mode: z.string().trim().min(1).max(60),
  instructions: z.string().max(5000).optional(),
  autoContinue: z.boolean().optional(),
})

// Extend createTaskSchema
export const createTaskSchema = z.object({
  // ... existing fields
  steps: z.array(taskStepSchema).max(10).optional(),
  // If steps provided, first step's agentId overrides top-level agentId
})
```

#### TaskStep API Endpoints

**New routes:**

`GET /api/tasks/[id]/steps` — list all steps for a task (admin session required)

`PUT /api/tasks/[id]/steps/[stepId]` — update a step (mark done, save output, record error). Used by the dispatch system and by the agent API.

`POST /api/tasks/[id]/steps` — add steps to an existing task (admin only, task must be in BACKLOG)

**Agent-facing endpoint updates:**

`PUT /api/agent/tasks/[id]` — when an agent completes work, this endpoint now also:
1. Marks the current active step as `done` with the agent's output
2. Triggers chain advancement (see dispatch logic)

#### Chain Builder in Task Creation

**Extracted as a separate component:** `src/components/chain-builder.tsx`

When creating a task, a new "Workflow" section appears below the existing fields:

- **Default:** Single step (current behavior — just assign an agent)
- **Chain mode:** Click "+ Add Step" to build a multi-step chain
- Each step row shows: step number, description field, mode selector, agent/human selector, auto-continue toggle
- Steps can be reordered via drag
- Permission mode per step: analyze, verify, develop, review, human
- **Auto-continue toggle:** defaults ON for agent steps, OFF for human steps. When ON, the next step auto-dispatches. When OFF, the task pauses in WAITING.

#### Dispatch Logic

**First step trigger:** When a task with steps moves from `BACKLOG` to `IN_PROGRESS` (via the board UI, agent claim, or API), the first step's status is set to `"active"` and dispatch is triggered.

**When a chain step completes:**

1. Current step marked `status: "done"`, output saved
2. Check if there is a next step (by `order`)
3. If no more steps → task status set to `DONE`
4. If next step exists:
   a. If current step has `autoContinue: false` → task status set to `WAITING`, next step stays `pending`
   b. If next step mode is `"human"` → task status set to `WAITING`, next step set to `active` (human must pick up)
   c. If next step has an agent with a runtime configured → task status set to `IN_PROGRESS`, next step set to `active`, dispatch fires
   d. If next step has an agent without a runtime → task status set to `WAITING` (passive agent must poll)

**Execution model:** Dispatch is **fire-and-forget async**. The API request handler responds immediately after updating step/task status, then triggers dispatch via a detached async call (`dispatchStep(stepId).catch(console.error)`). This avoids blocking request handlers with potentially long-running AI API calls.

**When dispatch fails:**

1. Step status set to `"failed"`, `error` field populated with the error message
2. Task status set to `WAITING` (chain halted)
3. WebSocket event `step-failed` broadcast
4. No automatic retry — human must review the error and either:
   - Retry the step (UI button → re-triggers dispatch)
   - Skip the step (UI button → marks step `"skipped"`, advances chain)
   - Edit the step and retry

### Part 4: Chain Templates

Reusable workflow patterns that users can apply when creating a task. Project-scoped — templates reference agents from the same project.

#### Schema

```prisma
model ChainTemplate {
  id          String   @id @default(cuid())
  name        String   // "Support Investigation", "Documentation Review"
  description String?
  icon        String   @default("🔗")
  projectId   String
  project     Project  @relation(fields: [projectId], references: [id], onDelete: Cascade)
  steps       String   // JSON array: [{agentId?, humanLabel?, mode, instructions?, autoContinue}]
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
}
```

**Reciprocal relation on Project model:**
```prisma
model Project {
  // ... existing fields
  chainTemplates  ChainTemplate[]
}
```

**Why JSON for steps instead of a relation:** Template steps are a blueprint — they aren't "live" like TaskStep records. They're copied into real TaskSteps when applied to a task. Storing as JSON keeps the model simple and avoids a second step-like table.

#### Pre-built Templates

Seeded on project creation (alongside starter agents if selected). Users can edit/delete these:

| Template | Steps |
|----------|-------|
| **Support Investigation** | Support Analyst (analyze, auto) → Developer (verify, auto) → Human (review, pause) → Developer (develop, auto) → Human (final check, pause) |
| **Documentation** | Writer (draft, auto) → Human (review, pause) → Writer (revise, auto) → Human (approve, pause) |
| **Feature Investigation** | Product Analyst (analyze, auto) → Developer (verify, auto) → Human (decision, pause) |
| **Bug Fix** | Developer (analyze, auto) → Developer (develop, auto) → QA (verify, auto) → Human (review, pause) |
| **Code Review** | Developer (review, auto) → Human (approve, pause) |

Templates reference agents by role, not by ID. When applied, the system matches template step roles to project agents. If multiple agents share a role, the user picks which one.

#### Template Zod Schema

```typescript
const chainTemplateStepSchema = z.object({
  agentId: z.string().optional().nullable(),
  agentRole: z.string().optional(),  // Used for role-based matching in pre-built templates
  humanLabel: z.string().max(120).optional(),
  mode: z.string().min(1).max(60),
  instructions: z.string().max(5000).optional(),
  autoContinue: z.boolean().default(true),
})

export const createChainTemplateSchema = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().max(500).optional(),
  icon: z.string().max(16).optional(),
  projectId: z.string().trim().min(1),
  steps: z.array(chainTemplateStepSchema).min(1).max(10),
})

export const updateChainTemplateSchema = createChainTemplateSchema
  .partial()
  .omit({ projectId: true })
  .refine((v) => Object.keys(v).length > 0, 'Provide at least one field')
```

#### API Endpoints

`GET /api/projects/[id]/chain-templates` — list templates for a project
`POST /api/projects/[id]/chain-templates` — create a template
`PUT /api/projects/[id]/chain-templates/[templateId]` — update a template
`DELETE /api/projects/[id]/chain-templates/[templateId]` — delete a template

#### Task Creation Flow with Templates

In the chain builder component, before the manual step list:

1. **Template selector** — dropdown/grid showing available templates for the project
2. User picks a template → steps pre-populate in the chain builder
3. Template steps with `agentRole` (not `agentId`) trigger a role-matching step:
   - If exactly one agent has that role → auto-assigned
   - If multiple agents match → user picks from a dropdown
   - If no agent matches → step left unassigned (user must pick manually)
4. User can then edit any step, add/remove steps, change agents
5. **"Save as Template"** button at bottom of chain builder — saves the current chain as a new template

#### UI: Template Management

Accessible from **Settings > Templates tab** (new tab alongside General, Agents, API, Activity):
- List of templates with name, icon, step count, last modified
- Edit/delete actions
- "Create Template" button

### Part 5: Board View Changes

#### New WAITING Column

Board columns become: **Backlog | In Progress | Waiting | Review | Done**

WAITING column styling:
- Amber/yellow color theme (dashed header border)
- Task cards show: current chain step indicator, who's next, step mode badge
- Left border accent color on cards

#### Task Card Enhancements

Cards in any column show chain progress when the task has multiple steps:

```
┌─────────────────────────┐
│ Login timeout #4821     │
│ 🔍 Support Analyst      │
│ [Step 1/4 · analyze]    │
└─────────────────────────┘
```

#### taskBoardInclude Update

```typescript
export const taskBoardInclude = {
  agent: { select: agentSummarySelect },
  project: { select: projectSummarySelect },
  steps: {
    select: {
      id: true,
      order: true,
      mode: true,
      status: true,
      agentId: true,
      humanLabel: true,
      autoContinue: true,
      agent: { select: { id: true, name: true, emoji: true } },
    },
    orderBy: { order: 'asc' as const },
  },
} as const
```

### Part 6: Runtime Adapter Architecture

Adapters are server-side modules that know how to call a specific AI provider.

```typescript
interface RuntimeAdapter {
  id: string                    // "anthropic" | "webhook"
  name: string
  available: boolean            // false for "coming soon" adapters
  dispatch(params: {
    systemPrompt: string        // Agent's prompt with variables resolved
    taskContext: string          // Task title + description + chain context
    previousOutput?: string     // Output from immediately preceding step
    mode: string                // Step permission mode
    mcpConnections?: McpConfig[]
    model: string
    runtimeConfig: Record<string, unknown>
  }): Promise<{
    output: string
    tokensUsed?: number
    cost?: number
  }>
}
```

**Initial adapters to build:**
1. **Anthropic** — calls Claude API with Messages API. Reads API key from `process.env[runtimeConfig.apiKeyEnvVar]`.
2. **Webhook** — POST to `runtimeConfig.endpoint` with task context as JSON body, expects `{ output: string }` response.

**Registered but unavailable (Coming Soon):**
3. OpenAI — `available: false`
4. Z.ai — `available: false`
5. GitHub Copilot — `available: false`

The webhook adapter is the escape hatch — any provider or custom system can integrate by receiving a POST. Users who want to use OpenAI/Z.ai today can do so via the webhook adapter pointed at their own wrapper service.

### Part 7: System Prompt Templates

Pre-built templates stored in code (not DB). Each maps to a role:

| Template | Role | Key Behaviors |
|----------|------|--------------|
| Researcher | researcher | Investigate, cite sources, structured report with confidence level |
| Developer | developer | Write clean code, follow conventions, output changes + tests + PR description |
| Support Analyst | support | Triage issues, reproduce bugs, root cause + impact + proposed fix |
| Product Analyst | analyst | Evaluate feasibility, effort estimate, ROI, recommendation |
| Writer | writer | Draft content, match tone/style, output draft + revision notes |
| QA | qa | Test systematically, document steps to reproduce, edge cases |

Templates are starting points — users edit freely after selecting.

### Part 8: Placeholder Resolution

System prompts support `{{variable}}` placeholders resolved at dispatch time.

**Available variables:**
- `{{task.title}}` — task title
- `{{task.description}}` — task description
- `{{step.mode}}` — current step's mode name (analyze, verify, develop, etc.)
- `{{step.instructions}}` — step-specific instructions from the chain step
- `{{step.previousOutput}}` — output from the immediately preceding step (empty string for first step)
- `{{mode.instructions}}` — the agent's per-mode instructions for the current mode (from `agent.modeInstructions[step.mode]`), falling back to the project mode's default instructions
- `{{mode.label}}` — display label of the current mode (e.g., "Verify")
- `{{agent.name}}` — agent's name
- `{{agent.role}}` — agent's role
- `{{agent.capabilities}}` — comma-separated capability tags

**Resolution behavior:**
- Unrecognized placeholders (e.g., `{{foo.bar}}`) are left as-is in the prompt (not removed, not errored)
- No nested access — only the listed flat variables are supported
- `{{step.previousOutput}}` always refers to the step with `order = currentStep.order - 1`

### Part 9: WebSocket Events for Chains

New events broadcast via `broadcastProjectEvent`:

| Event | Payload | When |
|-------|---------|------|
| `step-activated` | `{ taskId, stepId, step }` | A step begins execution |
| `step-completed` | `{ taskId, stepId, step, output }` | A step finishes successfully |
| `step-failed` | `{ taskId, stepId, step, error }` | A step dispatch fails |
| `chain-advanced` | `{ taskId, fromStep, toStep, task }` | Task moves to next step |
| `chain-completed` | `{ taskId, task }` | All steps done, task moves to DONE |

These supplement (not replace) existing `task-moved`, `task-updated` events.

## Out of Scope

- **ETL/RAG pipelines** (Stage 2 of the 2026 framework) — agents use MCPs or receive context through the chain
- **Automated eval harness** (Stage 5) — human review steps in chains serve as manual quality gates
- **Live observability dashboard** (Stage 6) — future feature, design exists as HTML reference
- **Semantic drift detection** — future
- **Blue/green agent deployments** — future

## Migration

- All new fields are optional → existing agents continue to work unchanged
- Existing tasks with no chain steps behave exactly as today (single assignee, no WAITING state)
- The WAITING status is additive to the enum — no existing task data changes
- Frontend detects whether a task has chain steps and renders accordingly

## File Impact

| Area | Files |
|------|-------|
| **Schema** | `prisma/schema.prisma` — Agent fields + TaskStep + ChainTemplate + ProjectMode + ProjectRuntime + ProjectMcpConnection + WAITING enum + relations |
| **Validation** | `src/lib/server/contracts.ts` — Zod schemas for agent, taskStep, chainTemplate, projectMode, projectRuntime, projectMcp |
| **Agent API** | `src/app/api/agents/route.ts` — accept + return new fields |
| **Agent API** | `src/app/api/agents/[id]/route.ts` — update select clauses, accept new fields in PUT |
| **Task API** | `src/app/api/tasks/route.ts` — chain step creation from steps array or template |
| **Task Steps API** | New: `src/app/api/tasks/[id]/steps/route.ts` — GET + POST |
| **Task Steps API** | New: `src/app/api/tasks/[id]/steps/[stepId]/route.ts` — PUT |
| **Settings: Modes API** | New: `src/app/api/projects/[id]/modes/route.ts` — GET + POST |
| **Settings: Modes API** | New: `src/app/api/projects/[id]/modes/[modeId]/route.ts` — PUT + DELETE |
| **Settings: Runtimes API** | New: `src/app/api/projects/[id]/runtimes/route.ts` — GET + POST |
| **Settings: Runtimes API** | New: `src/app/api/projects/[id]/runtimes/[rid]/route.ts` — PUT + DELETE |
| **Settings: MCP API** | New: `src/app/api/projects/[id]/mcp-connections/route.ts` — GET + POST |
| **Settings: MCP API** | New: `src/app/api/projects/[id]/mcp-connections/[cid]/route.ts` — PUT + DELETE |
| **Chain Templates API** | New: `src/app/api/projects/[id]/chain-templates/route.ts` — GET + POST |
| **Chain Templates API** | New: `src/app/api/projects/[id]/chain-templates/[templateId]/route.ts` — PUT + DELETE |
| **Dispatch** | New: `src/lib/server/dispatch.ts` — runtime adapter registry + dispatch logic + chain advancement |
| **Adapters** | New: `src/lib/server/adapters/anthropic.ts` |
| **Adapters** | New: `src/lib/server/adapters/webhook.ts` |
| **Prompt Templates** | New: `src/lib/server/prompt-templates.ts` — system prompt role templates |
| **Chain Templates** | New: `src/lib/server/chain-templates.ts` — pre-built chain templates seeded on project creation |
| **Mode Seeds** | New: `src/lib/server/default-modes.ts` — pre-built modes seeded on project creation |
| **Placeholders** | New: `src/lib/server/resolve-prompt.ts` — variable resolution including `{{mode.instructions}}` |
| **Selects** | `src/lib/server/selects.ts` — add steps to taskBoardInclude |
| **Frontend** | New: `src/components/agent-creation-modal.tsx` — 3-tab agent creation dialog (selects from Settings) |
| **Frontend** | New: `src/components/chain-builder.tsx` — workflow step builder with template selector |
| **Frontend** | New: `src/components/settings-modes.tsx` — Modes management tab |
| **Frontend** | New: `src/components/settings-runtimes.tsx` — Runtimes management tab |
| **Frontend** | New: `src/components/settings-mcp.tsx` — MCP connections management tab |
| **Frontend** | New: `src/components/settings-templates.tsx` — Chain templates management tab |
| **Frontend** | `src/app/page.tsx` — WAITING column, sidebar Create Agent button, wire up new settings tabs + components |
