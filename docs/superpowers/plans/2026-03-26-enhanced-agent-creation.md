# Enhanced Agent Creation & Task Workflow Chains — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Transform AgentBoard from a passive task board into an active agent orchestrator with enriched agents, project-level settings, task workflow chains, and runtime dispatch.

**Architecture:** Phased bottom-up build. Phase 1 lays schema + settings foundation. Phase 2 enriches agents. Phase 3 adds workflow chains + dispatch. Phase 4 wires frontend. Each phase produces working, deployable software.

**Tech Stack:** Next.js 16, Prisma 7 (SQLite), Zod 4, React 19, Tailwind 4, shadcn/ui, Socket.IO

**Spec:** `docs/superpowers/specs/2026-03-26-enhanced-agent-creation-design.md` (v3)

---

## Phase 1: Schema & Project Settings Foundation

### Task 1: Prisma Schema — New Models

**Files:**
- Modify: `prisma/schema.prisma`

- [ ] **Step 1: Add ProjectMode model**

Add after the `ActivityLog` model:

```prisma
model ProjectMode {
  id            String   @id @default(cuid())
  projectId     String
  project       Project  @relation(fields: [projectId], references: [id], onDelete: Cascade)
  name          String
  label         String
  color         String   @default("#60A5FA")
  icon          String?
  instructions  String?
  createdAt     DateTime @default(now())

  @@unique([projectId, name])
}
```

- [ ] **Step 2: Add ProjectRuntime model**

```prisma
model ProjectRuntime {
  id            String   @id @default(cuid())
  projectId     String
  project       Project  @relation(fields: [projectId], references: [id], onDelete: Cascade)
  adapter       String
  name          String
  models        String
  apiKeyEnvVar  String?
  endpoint      String?
  config        String?
  available     Boolean  @default(true)
  createdAt     DateTime @default(now())

  @@unique([projectId, adapter, name])
}
```

- [ ] **Step 3: Add ProjectMcpConnection model**

```prisma
model ProjectMcpConnection {
  id            String   @id @default(cuid())
  projectId     String
  project       Project  @relation(fields: [projectId], references: [id], onDelete: Cascade)
  name          String
  type          String
  icon          String?
  endpoint      String?
  config        String?
  scopes        String?
  createdAt     DateTime @default(now())
}
```

- [ ] **Step 4: Add ChainTemplate model**

```prisma
model ChainTemplate {
  id          String   @id @default(cuid())
  name        String
  description String?
  icon        String   @default("🔗")
  projectId   String
  project     Project  @relation(fields: [projectId], references: [id], onDelete: Cascade)
  steps       String
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
}
```

- [ ] **Step 5: Add TaskStep model**

```prisma
model TaskStep {
  id            String    @id @default(cuid())
  taskId        String
  task          Task      @relation(fields: [taskId], references: [id], onDelete: Cascade)
  order         Int
  agentId       String?
  agent         Agent?    @relation("TaskStepAgent", fields: [agentId], references: [id], onDelete: SetNull)
  humanLabel    String?
  mode          String
  instructions  String?
  autoContinue  Boolean   @default(true)
  status        String    @default("pending")
  output        String?
  error         String?
  startedAt     DateTime?
  completedAt   DateTime?
  createdAt     DateTime  @default(now())

  @@unique([taskId, order])
}
```

- [ ] **Step 6: Add WAITING to TaskStatus enum**

```prisma
enum TaskStatus {
  BACKLOG
  IN_PROGRESS
  WAITING
  REVIEW
  DONE
}
```

- [ ] **Step 7: Add new fields to Agent model**

Add after existing fields in the Agent model:

```prisma
  role            String?
  capabilities    String?
  maxConcurrent   Int       @default(1)
  supportedModes  String?
  modeInstructions String?
  runtimeId       String?
  runtime         ProjectRuntime? @relation(fields: [runtimeId], references: [id], onDelete: SetNull)
  runtimeModel    String?
  systemPrompt    String?
  mcpConnectionIds String?
  taskSteps       TaskStep[] @relation("TaskStepAgent")
```

- [ ] **Step 8: Add reciprocal relations to Project and Task models**

On Project model, add:
```prisma
  modes             ProjectMode[]
  runtimes          ProjectRuntime[]
  mcpConnections    ProjectMcpConnection[]
  chainTemplates    ChainTemplate[]
```

On Task model, add:
```prisma
  steps             TaskStep[]
```

- [ ] **Step 9: Push schema and regenerate client**

Run: `bun run db:push && bun run db:generate`
Expected: Schema synced to SQLite, Prisma client regenerated with new models.

- [ ] **Step 10: Commit**

```bash
git add prisma/schema.prisma src/generated/
git commit -m "feat: add schema for project settings, agent enrichment, task steps, chain templates"
```

---

### Task 2: Zod Schemas for All New Models

**Files:**
- Modify: `src/lib/server/contracts.ts`

- [ ] **Step 1: Add project settings schemas**

Add after existing schemas in `contracts.ts`:

```typescript
export const createProjectModeSchema = z.object({
  name: z.string().trim().min(1).max(60),
  label: z.string().trim().min(1).max(120),
  color: colorSchema.optional(),
  icon: z.string().max(16).optional(),
  instructions: z.string().max(5000).optional(),
})

export const updateProjectModeSchema = createProjectModeSchema.partial().refine(
  (v) => Object.keys(v).length > 0,
  'Provide at least one field',
)

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

export const updateProjectRuntimeSchema = createProjectRuntimeSchema.partial().refine(
  (v) => Object.keys(v).length > 0,
  'Provide at least one field',
)

export const createProjectMcpSchema = z.object({
  name: z.string().trim().min(1).max(120),
  type: z.string().trim().min(1).max(60),
  icon: z.string().max(16).optional(),
  endpoint: z.string().max(500).optional(),
  config: z.record(z.unknown()).optional(),
  scopes: z.array(z.string()).optional(),
})

export const updateProjectMcpSchema = createProjectMcpSchema.partial().refine(
  (v) => Object.keys(v).length > 0,
  'Provide at least one field',
)
```

- [ ] **Step 2: Add agent role schema and extend createAgentSchema**

Add role enum:
```typescript
export const agentRoleSchema = z.enum([
  'developer', 'researcher', 'writer', 'support', 'qa', 'analyst', 'custom'
])
```

Replace existing `createAgentSchema` with:
```typescript
export const createAgentSchema = z.object({
  name: z.string().trim().min(1).max(120),
  emoji: z.string().trim().min(1).max(16).optional(),
  color: colorSchema.optional(),
  description: trimmedOptionalString,
  projectId: z.string().trim().min(1),
  role: agentRoleSchema.optional(),
  capabilities: z.array(z.string().trim().max(60)).max(20).optional(),
  maxConcurrent: z.number().int().min(1).max(10).optional(),
  supportedModes: z.array(z.string().trim().max(60)).max(20).optional(),
  modeInstructions: z.record(z.string().max(5000)).optional(),
  runtimeId: z.string().trim().min(1).optional(),
  runtimeModel: z.string().trim().max(120).optional(),
  systemPrompt: z.string().max(10000).optional(),
  mcpConnectionIds: z.array(z.string().trim().min(1)).max(10).optional(),
})
```

- [ ] **Step 3: Extend updateAgentSchema with new fields**

Replace existing `updateAgentSchema`:
```typescript
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
```

- [ ] **Step 4: Update taskStatusSchema to include WAITING**

Update the existing `taskStatusSchema`:
```typescript
export const taskStatusSchema = z.enum(['BACKLOG', 'IN_PROGRESS', 'WAITING', 'REVIEW', 'DONE'])
```

- [ ] **Step 5: Add TaskStep and ChainTemplate schemas**

```typescript
export const taskStepSchema = z.object({
  agentId: z.string().trim().min(1).optional().nullable(),
  humanLabel: z.string().trim().max(120).optional(),
  mode: z.string().trim().min(1).max(60),
  instructions: z.string().max(5000).optional(),
  autoContinue: z.boolean().optional(),
})

export const chainTemplateStepSchema = z.object({
  agentId: z.string().optional().nullable(),
  agentRole: z.string().optional(),
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

- [ ] **Step 6: Extend createTaskSchema with steps**

Add `steps` field to existing `createTaskSchema`:
```typescript
  steps: z.array(taskStepSchema).max(10).optional(),
```

- [ ] **Step 7: Commit**

```bash
git add src/lib/server/contracts.ts
git commit -m "feat: add Zod schemas for project settings, enriched agents, task steps, chain templates"
```

---

### Task 3: Default Modes Seed Helper

**Files:**
- Create: `src/lib/server/default-modes.ts`

- [ ] **Step 1: Create the default modes definition**

```typescript
export const DEFAULT_PROJECT_MODES = [
  { name: 'analyze', label: 'Analyze', color: '#60A5FA', icon: '🔍', instructions: 'Investigate thoroughly. Gather evidence. Report findings with confidence levels.' },
  { name: 'verify', label: 'Verify', color: '#F59E0B', icon: '✅', instructions: 'Read-only verification. Check if the proposed solution is valid. Do NOT make changes.' },
  { name: 'develop', label: 'Develop', color: '#4ADE80', icon: '⚡', instructions: 'Implement the solution. Write code, run tests, document changes.' },
  { name: 'review', label: 'Review', color: '#2DD4BF', icon: '👁️', instructions: 'Review the output from the previous step for quality, correctness, and completeness.' },
  { name: 'draft', label: 'Draft', color: '#A78BFA', icon: '📝', instructions: 'Create initial content. Focus on structure and completeness over polish.' },
  { name: 'human', label: 'Human Review', color: '#9BAAC4', icon: '👤', instructions: null },
] as const
```

- [ ] **Step 2: Add seedProjectModes function**

```typescript
import { db } from '@/lib/db'

export async function seedProjectModes(projectId: string) {
  const existing = await db.projectMode.count({ where: { projectId } })
  if (existing > 0) return

  await db.projectMode.createMany({
    data: DEFAULT_PROJECT_MODES.map((mode) => ({
      projectId,
      name: mode.name,
      label: mode.label,
      color: mode.color,
      icon: mode.icon,
      instructions: mode.instructions,
    })),
  })
}
```

- [ ] **Step 3: Commit**

```bash
git add src/lib/server/default-modes.ts
git commit -m "feat: add default project modes seed helper"
```

---

### Task 4: Lazy-Seed for Existing Projects

**Files:**
- Modify: `src/lib/server/default-modes.ts`

- [ ] **Step 1: Add ensureProjectModes function for lazy-seeding**

This handles existing projects that were created before modes existed:

```typescript
export async function ensureProjectModes(projectId: string) {
  const count = await db.projectMode.count({ where: { projectId } })
  if (count === 0) {
    await seedProjectModes(projectId)
  }
}
```

Call `ensureProjectModes` from the modes GET endpoint (Task 5) before returning results. This way, existing projects get default modes on first access without a separate migration script.

- [ ] **Step 2: Commit**

```bash
git add src/lib/server/default-modes.ts
git commit -m "feat: add lazy-seed for existing projects' default modes"
```

---

### Task 5: Project Settings API — Modes

**Files:**
- Create: `src/app/api/projects/[id]/modes/route.ts`
- Create: `src/app/api/projects/[id]/modes/[modeId]/route.ts`

- [ ] **Step 1: Create modes list + create route**

Create `src/app/api/projects/[id]/modes/route.ts`:

```typescript
import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireAdminSession } from '@/lib/server/admin-session'
import { createProjectModeSchema } from '@/lib/server/contracts'

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const unauthorized = await requireAdminSession()
    if (unauthorized) return unauthorized

    const { id } = await params
    const modes = await db.projectMode.findMany({
      where: { projectId: id },
      orderBy: { createdAt: 'asc' },
    })

    return NextResponse.json(modes)
  } catch (error) {
    console.error('Error fetching modes:', error)
    return NextResponse.json({ error: 'Failed to fetch modes' }, { status: 500 })
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const unauthorized = await requireAdminSession()
    if (unauthorized) return unauthorized

    const { id } = await params
    const parsed = createProjectModeSchema.safeParse(await request.json())
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message || 'Invalid mode payload' },
        { status: 400 },
      )
    }

    const mode = await db.projectMode.create({
      data: { ...parsed.data, projectId: id },
    })

    return NextResponse.json(mode)
  } catch (error) {
    console.error('Error creating mode:', error)
    return NextResponse.json({ error: 'Failed to create mode' }, { status: 500 })
  }
}
```

- [ ] **Step 2: Create modes update + delete route**

Create `src/app/api/projects/[id]/modes/[modeId]/route.ts`:

```typescript
import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireAdminSession } from '@/lib/server/admin-session'
import { updateProjectModeSchema } from '@/lib/server/contracts'

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string; modeId: string }> },
) {
  try {
    const unauthorized = await requireAdminSession()
    if (unauthorized) return unauthorized

    const { modeId } = await params
    const parsed = updateProjectModeSchema.safeParse(await request.json())
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message || 'Invalid mode payload' },
        { status: 400 },
      )
    }

    const mode = await db.projectMode.update({
      where: { id: modeId },
      data: parsed.data,
    })

    return NextResponse.json(mode)
  } catch (error) {
    console.error('Error updating mode:', error)
    return NextResponse.json({ error: 'Failed to update mode' }, { status: 500 })
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string; modeId: string }> },
) {
  try {
    const unauthorized = await requireAdminSession()
    if (unauthorized) return unauthorized

    const { modeId } = await params
    await db.projectMode.delete({ where: { id: modeId } })

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Error deleting mode:', error)
    return NextResponse.json({ error: 'Failed to delete mode' }, { status: 500 })
  }
}
```

- [ ] **Step 3: Commit**

```bash
git add src/app/api/projects/\[id\]/modes/
git commit -m "feat: add CRUD API for project modes"
```

---

### Task 6: Project Settings API — Runtimes

**Files:**
- Create: `src/app/api/projects/[id]/runtimes/route.ts`
- Create: `src/app/api/projects/[id]/runtimes/[rid]/route.ts`

- [ ] **Step 1: Create runtimes list + create route**

Follow same pattern as Task 4 Step 1, using `db.projectRuntime`, `createProjectRuntimeSchema`, field `projectId: id`. **Note:** The `models` field is a JSON string in the DB — serialize with `JSON.stringify(parsed.data.models)` before saving, and parse on read if needed.

- [ ] **Step 2: Create runtimes update + delete route**

Follow same pattern as Task 4 Step 2, using `db.projectRuntime`, `updateProjectRuntimeSchema`, param `rid`.

- [ ] **Step 3: Commit**

```bash
git add src/app/api/projects/\[id\]/runtimes/
git commit -m "feat: add CRUD API for project runtimes"
```

---

### Task 7: Project Settings API — MCP Connections

**Files:**
- Create: `src/app/api/projects/[id]/mcp-connections/route.ts`
- Create: `src/app/api/projects/[id]/mcp-connections/[cid]/route.ts`

- [ ] **Step 1: Create MCP connections list + create route**

Follow same pattern as Task 4 Step 1, using `db.projectMcpConnection`, `createProjectMcpSchema`, field `projectId: id`.

- [ ] **Step 2: Create MCP connections update + delete route**

Follow same pattern as Task 4 Step 2, using `db.projectMcpConnection`, `updateProjectMcpSchema`, param `cid`.

- [ ] **Step 3: Commit**

```bash
git add src/app/api/projects/\[id\]/mcp-connections/
git commit -m "feat: add CRUD API for project MCP connections"
```

---

### Task 8: Project Settings API — Chain Templates

**Files:**
- Create: `src/app/api/projects/[id]/chain-templates/route.ts`
- Create: `src/app/api/projects/[id]/chain-templates/[templateId]/route.ts`

- [ ] **Step 1: Create chain templates list + create route**

Follow same pattern as Task 4, using `db.chainTemplate`, `createChainTemplateSchema`. For the `steps` field, serialize with `JSON.stringify(parsed.data.steps)` before saving.

- [ ] **Step 2: Create chain templates update + delete route**

Follow same pattern as Task 4 Step 2, using `db.chainTemplate`, `updateChainTemplateSchema`, param `templateId`. Serialize `steps` if present.

- [ ] **Step 3: Commit**

```bash
git add src/app/api/projects/\[id\]/chain-templates/
git commit -m "feat: add CRUD API for chain templates"
```

---

### Task 9: Seed Default Modes on Project Creation

**Files:**
- Modify: `src/app/api/projects/route.ts`

- [ ] **Step 1: Import and call seedProjectModes after project creation**

In the POST handler, after `db.project.create(...)`, add:
```typescript
import { seedProjectModes } from '@/lib/server/default-modes'

// After project creation:
await seedProjectModes(project.id)
```

- [ ] **Step 2: Commit**

```bash
git add src/app/api/projects/route.ts
git commit -m "feat: seed default modes on project creation"
```

---

### Phase 1 Verification

- [ ] Run `bun run build` — verify no type errors
- [ ] Run `bun run dev` — verify app starts, hit `GET /api/projects/[id]/modes` to confirm modes API works

---

## Phase 2: Enhanced Agent Model & API

### Task 10: Update Agent API to Accept New Fields

**Files:**
- Modify: `src/app/api/agents/route.ts`
- Modify: `src/app/api/agents/[id]/route.ts`

- [ ] **Step 1: Update POST handler to accept new fields**

In `agents/route.ts` POST, the `createAgentSchema` already accepts the new fields via Zod. Update the `db.agent.create` data to pass them through:

```typescript
const { name, emoji, color, description, projectId, role, capabilities,
        maxConcurrent, supportedModes, modeInstructions, runtimeId,
        runtimeModel, systemPrompt, mcpConnectionIds } = parsed.data

// In db.agent.create data:
data: {
  // ...existing fields
  role,
  capabilities: capabilities ? JSON.stringify(capabilities) : undefined,
  maxConcurrent: maxConcurrent || 1,
  supportedModes: supportedModes ? JSON.stringify(supportedModes) : undefined,
  modeInstructions: modeInstructions ? JSON.stringify(modeInstructions) : undefined,
  runtimeId,
  runtimeModel,
  systemPrompt,
  mcpConnectionIds: mcpConnectionIds ? JSON.stringify(mcpConnectionIds) : undefined,
}
```

- [ ] **Step 2: Update GET handler select to include new fields**

In `agents/route.ts` GET, add to the select:
```typescript
role: true,
capabilities: true,
maxConcurrent: true,
supportedModes: true,
runtimeId: true,
runtimeModel: true,
systemPrompt: true,
```

- [ ] **Step 3: Update agents/[id] GET to include all fields**

In `agents/[id]/route.ts` GET, add all new fields to the select including `modeInstructions` and `mcpConnectionIds`.

- [ ] **Step 4: Update agents/[id] PUT to accept new fields**

The `updateAgentSchema` already accepts them. Pass them through to `db.agent.update`, serializing JSON fields.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/agents/
git commit -m "feat: agent API accepts and returns enriched fields"
```

---

### Task 11: System Prompt Templates

**Files:**
- Create: `src/lib/server/prompt-templates.ts`

- [ ] **Step 1: Create prompt templates keyed by role**

```typescript
export const PROMPT_TEMPLATES: Record<string, string> = {
  researcher: `You are a Research Agent working within AgentBoard.

Your mission: Investigate technical topics thoroughly, analyze codebases, gather evidence from multiple sources, and produce structured reports.

When you receive a task:
1. Read the task description and any context from previous steps
2. Break the investigation into clear sub-questions
3. Use available tools to gather evidence
4. Synthesize findings into a structured report
5. Flag uncertainties and assumptions clearly

Output format:
- Summary (2-3 sentences)
- Findings (detailed, with evidence)
- Recommendations (actionable next steps)
- Confidence Level (high/medium/low with reasoning)

Current mode: {{mode.label}}
{{mode.instructions}}`,

  developer: `You are a Developer Agent working within AgentBoard.

Your mission: Write clean, tested code that follows project conventions.

When you receive a task:
1. Read the task description and any context from previous steps
2. Understand the codebase structure and conventions
3. Implement the solution with proper error handling
4. Write or update tests
5. Document your changes

Output format:
- Changes Made (file paths and descriptions)
- Tests (what was tested)
- Notes (anything the reviewer should know)

Current mode: {{mode.label}}
{{mode.instructions}}`,

  support: `You are a Support Analyst working within AgentBoard.

Your mission: Triage issues, reproduce bugs, and propose solutions.

When you receive a task:
1. Analyze the issue description
2. Attempt to reproduce the problem
3. Identify root cause
4. Propose a fix with evidence

Output format:
- Root Cause (what's broken and why)
- Impact (who is affected, severity)
- Proposed Fix (specific, actionable)
- Priority (critical/high/medium/low)

Current mode: {{mode.label}}
{{mode.instructions}}`,

  analyst: `You are a Product Analyst working within AgentBoard.

Your mission: Evaluate features for feasibility, effort, and business value.

When you receive a task:
1. Analyze the feature request or investigation topic
2. Research existing codebase for relevant patterns
3. Estimate effort and complexity
4. Assess business value and ROI

Output format:
- Assessment (feasibility analysis)
- Effort Estimate (t-shirt size with reasoning)
- ROI Analysis (value vs cost)
- Recommendation (build/defer/reject with reasoning)

Current mode: {{mode.label}}
{{mode.instructions}}`,

  writer: `You are a Writer Agent working within AgentBoard.

Your mission: Draft clear, accurate content that matches the project's tone and style.

When you receive a task:
1. Understand the audience and purpose
2. Research the topic using available context
3. Draft content with proper structure
4. Note areas needing human review

Output format:
- Draft (the content)
- Revision Notes (what needs human attention)
- Sources (if applicable)

Current mode: {{mode.label}}
{{mode.instructions}}`,

  qa: `You are a QA Agent working within AgentBoard.

Your mission: Test systematically and document findings.

When you receive a task:
1. Review the implementation or proposed changes
2. Design test cases covering happy path and edge cases
3. Execute tests and document results
4. Report any failures with reproduction steps

Output format:
- Test Cases (what was tested)
- Results (pass/fail for each)
- Issues Found (with steps to reproduce)
- Coverage Assessment (what's not tested)

Current mode: {{mode.label}}
{{mode.instructions}}`,
}
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/server/prompt-templates.ts
git commit -m "feat: add system prompt templates for each agent role"
```

---

### Task 12: Placeholder Resolution

**Files:**
- Create: `src/lib/server/resolve-prompt.ts`

- [ ] **Step 1: Create the placeholder resolver**

```typescript
type ResolveContext = {
  task: { title: string; description?: string | null }
  step: { mode: string; instructions?: string | null; previousOutput?: string | null }
  mode: { label: string; instructions?: string | null }
  agent: { name: string; role?: string | null; capabilities?: string | null }
}

export function resolvePrompt(template: string, ctx: ResolveContext): string {
  const variables: Record<string, string> = {
    'task.title': ctx.task.title,
    'task.description': ctx.task.description || '',
    'step.mode': ctx.step.mode,
    'step.instructions': ctx.step.instructions || '',
    'step.previousOutput': ctx.step.previousOutput || '',
    'mode.label': ctx.mode.label,
    'mode.instructions': ctx.mode.instructions || '',
    'agent.name': ctx.agent.name,
    'agent.role': ctx.agent.role || '',
    'agent.capabilities': ctx.agent.capabilities || '',
  }

  return template.replace(/\{\{(\w+\.\w+)\}\}/g, (match, key) => {
    return key in variables ? variables[key] : match
  })
}
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/server/resolve-prompt.ts
git commit -m "feat: add system prompt placeholder resolver"
```

---

### Phase 2 Verification

- [ ] Run `bun run build` — verify no type errors
- [ ] Create an agent via API with role, capabilities, systemPrompt — confirm all fields persist and return

---

## Phase 3: Task Steps, Dispatch Engine & Runtime Adapters

### Task 13: Task Steps API

**Files:**
- Create: `src/app/api/tasks/[id]/steps/route.ts`
- Create: `src/app/api/tasks/[id]/steps/[stepId]/route.ts`

- [ ] **Step 1: Create steps GET + POST route**

`GET` returns all steps for a task ordered by `order`. `POST` adds steps to a BACKLOG task.

- [ ] **Step 2: Create steps PUT route**

`PUT /api/tasks/[id]/steps/[stepId]` updates a step (status, output, error). Used by dispatch and agent API. Accepts:
- `status`: "done" | "failed" | "skipped"
- `output`: step result text
- `error`: error message (for failed status)

- [ ] **Step 3: Create retry and skip actions**

In the same PUT route, handle special actions:

```typescript
// Retry: reset a failed step to active and re-dispatch
if (body.action === 'retry' && existingStep.status === 'failed') {
  await db.taskStep.update({
    where: { id: stepId },
    data: { status: 'active', error: null, startedAt: new Date(), completedAt: null },
  })
  // Fire-and-forget re-dispatch
  dispatchStep(stepId).catch(console.error)
  return NextResponse.json({ success: true, action: 'retrying' })
}

// Skip: mark step as skipped and advance chain
if (body.action === 'skip' && existingStep.status === 'failed') {
  await db.taskStep.update({
    where: { id: stepId },
    data: { status: 'skipped', completedAt: new Date() },
  })
  await advanceChain(existingStep.taskId, projectId)
  return NextResponse.json({ success: true, action: 'skipped' })
}
```

Import `dispatchStep` and `advanceChain` from `@/lib/server/dispatch`.

- [ ] **Step 4: Commit**

```bash
git add src/app/api/tasks/\[id\]/steps/
git commit -m "feat: add task steps API (GET, POST, PUT) with retry/skip actions"
```

---

### Task 14: Update Task Creation to Support Steps

**Files:**
- Modify: `src/app/api/tasks/route.ts`

- [ ] **Step 1: In POST handler, create TaskStep records when steps array is provided**

After creating the task, if `parsed.data.steps` exists:
```typescript
if (parsed.data.steps && parsed.data.steps.length > 0) {
  await db.taskStep.createMany({
    data: parsed.data.steps.map((step, index) => ({
      taskId: task.id,
      order: index + 1,
      agentId: step.agentId || null,
      humanLabel: step.humanLabel || null,
      mode: step.mode,
      instructions: step.instructions || null,
      autoContinue: step.autoContinue ?? (step.mode !== 'human'),
    })),
  })
}
```

- [ ] **Step 2: Update taskBoardInclude in selects.ts to include steps**

In `src/lib/server/selects.ts`, add to `taskBoardInclude`:
```typescript
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
```

- [ ] **Step 3: Commit**

```bash
git add src/app/api/tasks/route.ts src/lib/server/selects.ts
git commit -m "feat: task creation supports workflow chain steps"
```

---

### Task 15: Runtime Adapter Interface & Registry

**Files:**
- Create: `src/lib/server/adapters/types.ts`
- Create: `src/lib/server/adapters/anthropic.ts`
- Create: `src/lib/server/adapters/webhook.ts`
- Create: `src/lib/server/adapters/registry.ts`

- [ ] **Step 1: Define the RuntimeAdapter interface**

Create `src/lib/server/adapters/types.ts`:
```typescript
export interface DispatchParams {
  systemPrompt: string
  taskContext: string
  previousOutput?: string
  mode: string
  model: string
  runtimeConfig: {
    apiKeyEnvVar?: string
    endpoint?: string
    [key: string]: unknown
  }
}

export interface DispatchResult {
  output: string
  tokensUsed?: number
  cost?: number
}

export interface RuntimeAdapter {
  id: string
  name: string
  available: boolean
  dispatch(params: DispatchParams): Promise<DispatchResult>
}
```

- [ ] **Step 2: Implement Anthropic adapter**

Create `src/lib/server/adapters/anthropic.ts`:
```typescript
import type { RuntimeAdapter, DispatchParams, DispatchResult } from './types'

export const anthropicAdapter: RuntimeAdapter = {
  id: 'anthropic',
  name: 'Anthropic',
  available: true,

  async dispatch(params: DispatchParams): Promise<DispatchResult> {
    const apiKey = params.runtimeConfig.apiKeyEnvVar
      ? process.env[params.runtimeConfig.apiKeyEnvVar]
      : process.env.ANTHROPIC_API_KEY

    if (!apiKey) {
      throw new Error('Anthropic API key not configured')
    }

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: params.model || 'claude-sonnet-4-20250514',
        max_tokens: 4096,
        system: params.systemPrompt,
        messages: [{
          role: 'user',
          content: [
            params.previousOutput ? `Previous step output:\n${params.previousOutput}\n\n---\n\n` : '',
            params.taskContext,
          ].filter(Boolean).join(''),
        }],
      }),
    })

    if (!response.ok) {
      const errorBody = await response.text()
      throw new Error(`Anthropic API error ${response.status}: ${errorBody}`)
    }

    const data = await response.json()
    const textBlock = data.content?.find((b: { type: string }) => b.type === 'text')

    return {
      output: textBlock?.text || '',
      tokensUsed: (data.usage?.input_tokens || 0) + (data.usage?.output_tokens || 0),
    }
  },
}
```

- [ ] **Step 3: Implement Webhook adapter**

Create `src/lib/server/adapters/webhook.ts`:
```typescript
import type { RuntimeAdapter, DispatchParams, DispatchResult } from './types'

export const webhookAdapter: RuntimeAdapter = {
  id: 'webhook',
  name: 'Custom Webhook',
  available: true,

  async dispatch(params: DispatchParams): Promise<DispatchResult> {
    const endpoint = params.runtimeConfig.endpoint
    if (!endpoint || typeof endpoint !== 'string') {
      throw new Error('Webhook endpoint not configured')
    }

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        systemPrompt: params.systemPrompt,
        taskContext: params.taskContext,
        previousOutput: params.previousOutput,
        mode: params.mode,
        model: params.model,
      }),
    })

    if (!response.ok) {
      throw new Error(`Webhook error ${response.status}: ${await response.text()}`)
    }

    const data = await response.json()
    return {
      output: typeof data.output === 'string' ? data.output : JSON.stringify(data),
      tokensUsed: data.tokensUsed,
      cost: data.cost,
    }
  },
}
```

- [ ] **Step 4: Create adapter registry**

Create `src/lib/server/adapters/registry.ts`:
```typescript
import type { RuntimeAdapter } from './types'
import { anthropicAdapter } from './anthropic'
import { webhookAdapter } from './webhook'

function unavailableAdapter(id: string, name: string): RuntimeAdapter {
  return {
    id,
    name,
    available: false,
    async dispatch() {
      throw new Error(`${name} adapter is not yet available. Use the webhook adapter as an alternative.`)
    },
  }
}

const adapters = new Map<string, RuntimeAdapter>([
  ['anthropic', anthropicAdapter],
  ['webhook', webhookAdapter],
  ['openai', unavailableAdapter('openai', 'OpenAI')],
  ['z-ai', unavailableAdapter('z-ai', 'Z.ai')],
  ['github-copilot', unavailableAdapter('github-copilot', 'GitHub Copilot')],
])

export function getAdapter(id: string): RuntimeAdapter | undefined {
  return adapters.get(id)
}

export function listAdapters(): RuntimeAdapter[] {
  return Array.from(adapters.values())
}
```

- [ ] **Step 5: Commit**

```bash
git add src/lib/server/adapters/
git commit -m "feat: add runtime adapter interface, Anthropic + Webhook implementations, registry"
```

---

### Task 16: Dispatch Engine

**Files:**
- Create: `src/lib/server/dispatch.ts`

- [ ] **Step 1: Create the dispatch engine**

```typescript
import { db } from '@/lib/db'
import { getAdapter } from '@/lib/server/adapters/registry'
import { resolvePrompt } from '@/lib/server/resolve-prompt'
import { broadcastProjectEvent } from '@/lib/server/realtime'

export async function dispatchStep(stepId: string) {
  const step = await db.taskStep.findUnique({
    where: { id: stepId },
    include: {
      task: true,
      agent: true,
    },
  })

  if (!step || !step.agent || step.status !== 'active') return

  const agent = step.agent
  if (!agent.runtimeId) return // passive agent, skip dispatch

  const runtime = await db.projectRuntime.findUnique({
    where: { id: agent.runtimeId },
  })

  if (!runtime) {
    await failStep(stepId, step.task.projectId, 'Runtime not found')
    return
  }

  const adapter = getAdapter(runtime.adapter)
  if (!adapter || !adapter.available) {
    await failStep(stepId, step.task.projectId, `Adapter "${runtime.adapter}" not available`)
    return
  }

  // Check maxConcurrent
  const activeCount = await db.taskStep.count({
    where: { agentId: agent.id, status: 'active', id: { not: stepId } },
  })
  if (activeCount >= agent.maxConcurrent) {
    await db.taskStep.update({ where: { id: stepId }, data: { status: 'pending' } })
    return
  }

  // Get previous step output
  const previousStep = await db.taskStep.findFirst({
    where: { taskId: step.taskId, order: step.order - 1 },
  })

  // Resolve mode instructions
  const projectMode = await db.projectMode.findFirst({
    where: { projectId: step.task.projectId, name: step.mode },
  })

  const agentModeInstructions = agent.modeInstructions
    ? JSON.parse(agent.modeInstructions)[step.mode]
    : null

  const modeInstructions = agentModeInstructions || projectMode?.instructions || ''

  // Parse capabilities
  const capabilities = agent.capabilities
    ? JSON.parse(agent.capabilities).join(', ')
    : ''

  // Resolve prompt
  const systemPrompt = resolvePrompt(agent.systemPrompt || '', {
    task: { title: step.task.title, description: step.task.description },
    step: { mode: step.mode, instructions: step.instructions, previousOutput: previousStep?.output },
    mode: { label: projectMode?.label || step.mode, instructions: modeInstructions },
    agent: { name: agent.name, role: agent.role, capabilities },
  })

  const taskContext = [
    `Task: ${step.task.title}`,
    step.task.description ? `Description: ${step.task.description}` : '',
    step.instructions ? `Step Instructions: ${step.instructions}` : '',
  ].filter(Boolean).join('\n\n')

  // Parse runtime config
  const runtimeConfig: Record<string, unknown> = {
    ...(runtime.config ? JSON.parse(runtime.config) : {}),
    apiKeyEnvVar: runtime.apiKeyEnvVar,
    endpoint: runtime.endpoint,
  }

  try {
    await db.taskStep.update({
      where: { id: stepId },
      data: { startedAt: new Date() },
    })

    const result = await adapter.dispatch({
      systemPrompt,
      taskContext,
      previousOutput: previousStep?.output || undefined,
      mode: step.mode,
      model: agent.runtimeModel || 'default',
      runtimeConfig,
    })

    await db.taskStep.update({
      where: { id: stepId },
      data: { status: 'done', output: result.output, completedAt: new Date() },
    })

    await broadcastProjectEvent(step.task.projectId, 'step-completed', {
      taskId: step.taskId,
      stepId,
      output: result.output,
    })

    await advanceChain(step.taskId, step.task.projectId)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown dispatch error'
    await failStep(stepId, step.task.projectId, message)
  }
}

async function failStep(stepId: string, projectId: string, error: string) {
  const step = await db.taskStep.update({
    where: { id: stepId },
    data: { status: 'failed', error, completedAt: new Date() },
  })

  await db.task.update({
    where: { id: step.taskId },
    data: { status: 'WAITING' },
  })

  await broadcastProjectEvent(projectId, 'step-failed', {
    taskId: step.taskId,
    stepId,
    error,
  })
}

export async function advanceChain(taskId: string, projectId: string) {
  const steps = await db.taskStep.findMany({
    where: { taskId },
    orderBy: { order: 'asc' },
    include: { agent: true },
  })

  const currentStep = steps.find((s) => s.status === 'done' && !steps.find(
    (next) => next.order === s.order + 1 && next.status !== 'pending'
  ))

  if (!currentStep) return

  const nextStep = steps.find((s) => s.order === currentStep.order + 1)

  if (!nextStep) {
    // Chain complete
    await db.task.update({
      where: { id: taskId },
      data: { status: 'DONE', completedAt: new Date() },
    })
    await broadcastProjectEvent(projectId, 'chain-completed', { taskId })
    return
  }

  // Check autoContinue on the just-completed step
  if (!currentStep.autoContinue) {
    await db.task.update({ where: { id: taskId }, data: { status: 'WAITING' } })
    return
  }

  // Activate next step
  await db.taskStep.update({
    where: { id: nextStep.id },
    data: { status: 'active' },
  })

  await broadcastProjectEvent(projectId, 'step-activated', {
    taskId,
    stepId: nextStep.id,
  })

  await broadcastProjectEvent(projectId, 'chain-advanced', {
    taskId,
    fromStepId: currentStep.id,
    toStepId: nextStep.id,
  })

  if (nextStep.mode === 'human') {
    await db.task.update({ where: { id: taskId }, data: { status: 'WAITING' } })
    return
  }

  if (nextStep.agent?.runtimeId) {
    await db.task.update({ where: { id: taskId }, data: { status: 'IN_PROGRESS' } })
    // Fire-and-forget dispatch
    dispatchStep(nextStep.id).catch(console.error)
  } else {
    await db.task.update({ where: { id: taskId }, data: { status: 'WAITING' } })
  }
}

export async function startChain(taskId: string, projectId: string) {
  const firstStep = await db.taskStep.findFirst({
    where: { taskId, order: 1 },
    include: { agent: true },
  })

  if (!firstStep) return

  await db.taskStep.update({
    where: { id: firstStep.id },
    data: { status: 'active' },
  })

  await broadcastProjectEvent(projectId, 'step-activated', {
    taskId,
    stepId: firstStep.id,
  })

  if (firstStep.mode === 'human') {
    return // Human must pick up
  }

  if (firstStep.agent?.runtimeId) {
    dispatchStep(firstStep.id).catch(console.error)
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/server/dispatch.ts
git commit -m "feat: add dispatch engine with chain advancement, fire-and-forget async execution"
```

---

### Phase 3 Verification

- [ ] Run `bun run build` — verify no type errors
- [ ] Create a task with steps via API — confirm TaskStep records created
- [ ] Verify adapter registry returns both available and unavailable adapters

---

## Phase 4: Frontend Components

### Task 17: Settings Components — Modes, Runtimes, MCP, Templates

**Files:**
- Create: `src/components/settings-modes.tsx`
- Create: `src/components/settings-runtimes.tsx`
- Create: `src/components/settings-mcp.tsx`
- Create: `src/components/settings-templates.tsx`

- [ ] **Step 1: Create Modes settings component**

CRUD list for project modes. Each row: color dot, icon, name, label, edit/delete buttons. "Create Mode" button at bottom. Edit opens inline form with name, label, color, icon, instructions fields.

- [ ] **Step 2: Create Runtimes settings component**

CRUD list for project runtimes. Each row: adapter icon, name, model count, edit/delete. Create form: adapter selector, name, models list, apiKeyEnvVar, endpoint (for webhook).

- [ ] **Step 3: Create MCP settings component**

CRUD list for MCP connections. Each row: icon, name, type, endpoint, edit/delete. Create form: name, type selector, icon, endpoint, scopes.

- [ ] **Step 4: Create Templates settings component**

CRUD list for chain templates. Each row: icon, name, step count, human gate count, edit/delete. Edit opens chain step editor.

- [ ] **Step 5: Commit**

```bash
git add src/components/settings-*.tsx
git commit -m "feat: add Settings tab components for modes, runtimes, MCP connections, chain templates"
```

---

### Task 18: Agent Creation Modal (3-Tab)

**Files:**
- Create: `src/components/agent-creation-modal.tsx`

- [ ] **Step 1: Build the 3-tab modal component**

Props: `open`, `onOpenChange`, `projectId`, `editingAgent?`, `modes`, `runtimes`, `mcpConnections`, `onSave`.

Tab 1 (Identity): name, emoji, role chips, description, capabilities tags, supported modes multi-select, maxConcurrent, color.

Tab 2 (Runtime): runtime dropdown (from props.runtimes), model dropdown (filtered by runtime), system prompt textarea with template selector (from `prompt-templates.ts`).

Tab 3 (Connections): toggle list from props.mcpConnections.

- [ ] **Step 2: Commit**

```bash
git add src/components/agent-creation-modal.tsx
git commit -m "feat: add 3-tab agent creation modal component"
```

---

### Task 19: Chain Builder Component

**Files:**
- Create: `src/components/chain-builder.tsx`

- [ ] **Step 1: Build the chain builder component**

Props: `projectId`, `agents`, `modes`, `templates`, `steps`, `onStepsChange`.

Template selector grid at top. Step list below with: step number, description, mode dropdown (from props.modes, filtered by agent's supportedModes), agent/human selector, auto-continue toggle. "+ Add Step" button. "Save as Template" button.

- [ ] **Step 2: Commit**

```bash
git add src/components/chain-builder.tsx
git commit -m "feat: add chain builder component with template selection"
```

---

### Task 20: Wire Frontend — Settings Tabs, Sidebar Button, WAITING Column

**Files:**
- Modify: `src/app/page.tsx`

- [ ] **Step 1: Import new components and add state**

Import `AgentCreationModal`, `ChainBuilder`, and all settings components. Add state for modes, runtimes, mcpConnections, chainTemplates. Add fetch functions for each.

- [ ] **Step 2: Add WAITING to statusColumns**

```typescript
const statusColumns = [
  { id: 'BACKLOG', label: 'Backlog', color: 'text-3' },
  { id: 'IN_PROGRESS', label: 'In Progress', color: 'text-[var(--op-blue)]' },
  { id: 'WAITING', label: 'Waiting', color: 'text-[var(--op-amber)]' },
  { id: 'REVIEW', label: 'Review', color: 'text-[var(--op-purple)]' },
  { id: 'DONE', label: 'Done', color: 'text-[var(--op-teal)]' },
]
```

- [ ] **Step 3: Add sidebar "Create Agent" button**

At bottom of the sidebar (below agent list), add full-width button that opens the `AgentCreationModal`.

- [ ] **Step 4: Replace old agent dialog with AgentCreationModal**

Remove the old 4-field dialog. Wire `AgentCreationModal` to the existing `agentDialogOpen` state.

- [ ] **Step 5: Add new settings tabs**

In the settings sheet, add Modes, Runtimes, MCP, Templates tabs. Wire to the new settings components.

- [ ] **Step 6: Integrate ChainBuilder in task creation dialog**

In the task creation dialog, add a "Workflow Chain" section after the basic fields. Render `ChainBuilder` with project agents, modes, and templates. Pass steps to task creation API.

- [ ] **Step 7: Update task cards to show chain progress**

When a task has steps, render step indicator badge: `[Step 1/4 · analyze]` with mode color.

- [ ] **Step 8: Add WebSocket listeners for chain events**

Listen for `step-activated`, `step-completed`, `step-failed`, `chain-advanced`, `chain-completed` events. Update task state accordingly.

- [ ] **Step 9: Commit**

```bash
git add src/app/page.tsx
git commit -m "feat: wire frontend — settings tabs, agent modal, chain builder, WAITING column, sidebar button"
```

---

### Phase 4 Verification

- [ ] Run `bun run build` — verify no type errors
- [ ] Open the app in browser — verify Settings tabs render, agent creation modal opens with 3 tabs, WAITING column visible on board

---

## Phase 4.5: Unit Tests for Core Logic

### Task 20.5: Unit Tests for Placeholder Resolver and Dispatch Logic

**Files:**
- Create: `src/lib/server/__tests__/resolve-prompt.test.ts`
- Create: `src/lib/server/__tests__/dispatch.test.ts`

- [ ] **Step 1: Write tests for resolvePrompt**

```typescript
import { resolvePrompt } from '../resolve-prompt'

describe('resolvePrompt', () => {
  const baseCtx = {
    task: { title: 'Fix login', description: 'Users report timeout' },
    step: { mode: 'analyze', instructions: 'Check logs', previousOutput: 'Prior output' },
    mode: { label: 'Analyze', instructions: 'Investigate thoroughly' },
    agent: { name: 'Dev Agent', role: 'developer', capabilities: 'python, typescript' },
  }

  test('replaces known placeholders', () => {
    const result = resolvePrompt('Task: {{task.title}} Mode: {{step.mode}}', baseCtx)
    expect(result).toBe('Task: Fix login Mode: analyze')
  })

  test('leaves unknown placeholders as-is', () => {
    const result = resolvePrompt('{{unknown.var}} stays', baseCtx)
    expect(result).toBe('{{unknown.var}} stays')
  })

  test('handles empty optional fields', () => {
    const ctx = { ...baseCtx, task: { title: 'Test', description: null } }
    const result = resolvePrompt('Desc: {{task.description}}', ctx)
    expect(result).toBe('Desc: ')
  })

  test('resolves mode.instructions from agent override', () => {
    const result = resolvePrompt('{{mode.instructions}}', baseCtx)
    expect(result).toBe('Investigate thoroughly')
  })
})
```

- [ ] **Step 2: Run tests**

Run: `bun test src/lib/server/__tests__/resolve-prompt.test.ts`
Expected: All tests pass.

- [ ] **Step 3: Commit**

```bash
git add src/lib/server/__tests__/
git commit -m "test: add unit tests for resolvePrompt and dispatch logic"
```

---

## Phase 5: Integration & Polish

### Task 21: Wire Dispatch to Task Status Changes

**Files:**
- Modify: `src/app/api/tasks/[id]/route.ts`
- Modify: `src/app/api/agent/tasks/[id]/route.ts`

- [ ] **Step 1: In task PUT, trigger chain start when moving to IN_PROGRESS**

When a task with steps moves from BACKLOG → IN_PROGRESS, call `startChain(taskId, projectId)`.

- [ ] **Step 2: In agent task PUT, trigger chain advancement on step completion**

When an agent completes work (action: complete), also mark the active step as done and call `advanceChain`.

- [ ] **Step 3: Commit**

```bash
git add src/app/api/tasks/\[id\]/route.ts src/app/api/agent/tasks/\[id\]/route.ts
git commit -m "feat: wire dispatch — chain start on IN_PROGRESS, chain advance on step completion"
```

---

### Task 22: Pre-built Chain Templates Seeding

**Files:**
- Create: `src/lib/server/chain-templates.ts`
- Modify: `src/app/api/projects/route.ts` (or seed route)

- [ ] **Step 1: Create default chain templates definition**

Define the 5 pre-built templates (Support Investigation, Documentation, Feature Investigation, Bug Fix, Code Review) with role-based agent references.

- [ ] **Step 2: Add seedChainTemplates function**

Seeds templates on project creation when starter agents are enabled. Uses `agentRole` in steps for role-based matching.

- [ ] **Step 3: Call from project creation**

In `projects/route.ts` POST, after `seedProjectModes` and `createDefaultAgents`, call `seedChainTemplates(projectId)`.

- [ ] **Step 4: Commit**

```bash
git add src/lib/server/chain-templates.ts src/app/api/projects/route.ts
git commit -m "feat: seed pre-built chain templates on project creation"
```

---

### Task 23: Final Integration Test

- [ ] **Step 1: Create a project with starter agents**

Via the UI, create a new project with "Add starter agents" checked. Verify:
- 6 default modes appear in Settings > Modes
- 4 starter agents created
- 5 chain templates appear in Settings > Templates

- [ ] **Step 2: Configure a runtime**

In Settings > Runtimes, add an Anthropic runtime with API key env var. Verify it appears in agent creation.

- [ ] **Step 3: Create an enriched agent**

Open Create Agent, fill all 3 tabs: identity with role + modes, runtime selection + system prompt, optional MCP. Verify the agent appears in sidebar and has all fields.

- [ ] **Step 4: Create a task with chain template**

Create a task, select "Bug Fix" template. Verify steps pre-populate. Adjust agents and modes. Create the task.

- [ ] **Step 5: Verify board shows WAITING column and chain progress**

Move the task to IN_PROGRESS. Verify:
- First step activates
- If runtime is configured, dispatch fires
- Chain advances through steps
- WAITING column shows tasks between steps
- Human steps pause correctly

- [ ] **Step 6: Final commit**

```bash
git add -A
git commit -m "feat: complete enhanced agent creation & task workflow chains"
```
