# Artifacts (First-Class Outputs) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make tasks produce files, patches, docs, URLs, screenshots, logs, and test results as first-class outputs — not just text blobs. The board should let humans review artifacts directly.

**Architecture:** Add a `StepArtifact` model that stores typed outputs per step execution. Artifacts can be inline (text/JSON stored in DB) or external (URL/path reference). The agent API and step viewer are extended to produce and display artifacts. MCP tool responses that return structured data (images, files) are auto-captured as artifacts.

**Tech Stack:** Next.js 16, Prisma 7 (SQLite), Zod 4, React 19, Tailwind 4, shadcn/ui

---

## Task 1: Add StepArtifact model

**Files:**
- Modify: `prisma/schema.prisma`
- Modify: `src/lib/server/contracts.ts`

- [ ] **Step 1: Add StepArtifact model**

```prisma
model StepArtifact {
  id            String    @id @default(cuid())
  stepId        String
  step          TaskStep  @relation(fields: [stepId], references: [id], onDelete: Cascade)
  executionId   String?
  type          String    // text, code, diff, url, image, file, json, log, test_result
  label         String    // human-readable name ("Generated patch", "Test results")
  content       String?   // inline content (text, code, JSON, diff)
  url           String?   // external URL (image, file download, screenshot)
  mimeType      String?   // e.g., "application/json", "image/png", "text/x-diff"
  metadata      String?   // JSON — extra info (language for code, line count, file path)
  createdAt     DateTime  @default(now())
}
```

Add relation to `TaskStep`:
```prisma
  artifacts     StepArtifact[]
```

- [ ] **Step 2: Add artifact Zod schema**

```typescript
export const stepArtifactSchema = z.object({
  type: z.enum(['text', 'code', 'diff', 'url', 'image', 'file', 'json', 'log', 'test_result']),
  label: z.string().trim().min(1).max(240),
  content: z.string().max(50000).optional(),
  url: z.string().url().max(2000).optional(),
  mimeType: z.string().max(120).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
})
```

- [ ] **Step 3: Push schema, regenerate, commit**

```bash
bun run db:push --accept-data-loss && bun run db:generate
git add prisma/schema.prisma src/lib/server/contracts.ts src/generated/
git commit -m "feat: add StepArtifact model for first-class task outputs"
```

---

## Task 2: Artifact CRUD API

**Files:**
- Create: `src/app/api/tasks/[id]/steps/[stepId]/artifacts/route.ts`

- [ ] **Step 1: Create artifacts endpoint**

```typescript
// GET — list artifacts for a step
// POST — create an artifact (used by agents and the dispatch engine)
```

GET returns all artifacts for the step. POST validates with `stepArtifactSchema` and creates the record.

- [ ] **Step 2: Allow agents to submit artifacts via task API**

In the agent task API (`/api/agent/tasks/[id]/route.ts`), accept an optional `artifacts` array in the request body alongside `output`. When present, create `StepArtifact` records for the active step.

- [ ] **Step 3: Commit**

```bash
git add src/app/api/tasks/[id]/steps/[stepId]/artifacts/route.ts src/app/api/agent/tasks/[id]/route.ts
git commit -m "feat: add artifact CRUD API and agent artifact submission"
```

---

## Task 3: Auto-capture MCP tool artifacts

**Files:**
- Modify: `src/lib/server/mcp-resolver.ts`

- [ ] **Step 1: Extract non-text MCP content as artifacts**

In `executeMcpTool`, the MCP response `content` array can contain `image`, `resource`, and other types beyond `text`. Currently these are silently dropped. Instead, return them as structured data that the adapter can save as artifacts.

Change `executeMcpTool` return type from `Promise<string>` to `Promise<{ text: string; artifacts: Array<{ type: string; label: string; content?: string; url?: string; mimeType?: string }> }>`.

Adapters extract `.text` for the conversation and pass `.artifacts` back for storage.

- [ ] **Step 2: Commit**

```bash
git add src/lib/server/mcp-resolver.ts
git commit -m "feat: auto-capture non-text MCP tool responses as artifacts"
```

---

## Task 4: Artifact viewer component

**Files:**
- Create: `src/components/artifact-viewer.tsx`
- Modify: `src/components/step-output-viewer.tsx`

- [ ] **Step 1: Create artifact viewer**

A component that renders different artifact types:
- `text` / `log` — monospace text block
- `code` — syntax-highlighted code block (react-syntax-highlighter)
- `diff` — diff-style rendering (green/red lines)
- `json` — collapsible JSON tree
- `url` — clickable link with preview
- `image` — inline image with lightbox
- `test_result` — pass/fail badges with detail

- [ ] **Step 2: Wire into step output viewer**

In `step-output-viewer.tsx`, below the text output, show an "Artifacts" section listing all artifacts for the step. Each artifact shows its label, type badge, and renders via `ArtifactViewer`.

- [ ] **Step 3: Commit**

```bash
git add src/components/artifact-viewer.tsx src/components/step-output-viewer.tsx
git commit -m "feat: add artifact viewer with multi-type rendering"
```

---

## Summary

| Task | File(s) | What changes |
|------|---------|-------------|
| 1 | `schema.prisma`, `contracts.ts` | StepArtifact model + Zod schema |
| 2 | `artifacts/route.ts`, `agent/tasks/[id]/route.ts` | Artifact CRUD + agent submission |
| 3 | `mcp-resolver.ts` | Auto-capture non-text MCP content |
| 4 | `artifact-viewer.tsx`, `step-output-viewer.tsx` | Multi-type artifact rendering |
