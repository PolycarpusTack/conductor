# Epic S6 — Task Templates

**Goal:** the form-side counterpart to chain templates: saved task defaults (title
pattern, description, priority, tag, notes, attached chain template) that prefill the
board's task-create dialog. CRUD first; versioning/share-to-workspace/archive are
stretch goals and explicitly out of scope this round.

**Verified against codebase 2026-06-05:**
- Chain templates are the structural model to mirror: `ChainTemplate` (schema.prisma:182),
  `createChainTemplateSchema` (contracts.ts:239), CRUD at
  `api/projects/[id]/chain-templates(/[templateId])`, edited in `settings-templates.tsx`,
  fetched in `useProjectData.fetchProjectSettings`, consumed by `TaskDialog` via the
  Epic S1 default-template prefill effect (task-dialog.tsx:72).
- The Templates settings tab renders `SettingsTemplates` only (settings-dialog.tsx:606).
- Task dialog state lives in `useTaskManager`; `BoardView` wires it all together.

## Task 1 — Model + contracts + CRUD routes (TDD)

- [x] `TaskTemplate` model: `name`, `icon` (default 📋), `projectId` (cascade),
  `titlePattern?`, `description?`, `priority?`, `tag?`, `notes?`,
  `chainTemplateId?` (FK to ChainTemplate, `onDelete: SetNull` so deleting a chain
  template degrades the task template instead of breaking it), timestamps.
- [x] Contracts: `createTaskTemplateSchema` (name required; priority is the
  LOW/MEDIUM/HIGH/URGENT enum; everything else optional/nullable),
  `updateTaskTemplateSchema = partial + at-least-one-field refine`.
- [x] Routes mirroring chain-templates: `GET/POST api/projects/[id]/task-templates`,
  `PUT/DELETE api/projects/[id]/task-templates/[templateId]`. POST/PUT validate that
  a provided `chainTemplateId` belongs to the same project.
- [x] Tests (`task-templates.test.ts`): create happy path, validation reject,
  cross-project chainTemplateId reject, PUT not-found scoping, DELETE.

## Task 2 — Settings UI + data plumbing

- [x] `TaskTemplate` type in `types/settings.ts`.
- [x] `useProjectData`: `taskTemplates` state, fetched alongside chain templates in
  `fetchProjectSettings`, exported.
- [x] New `SettingsTaskTemplates` component (own file, list+form in the
  settings-templates idiom): name/icon, title pattern, description, priority select,
  tag, notes, attached-chain select (None + project chain templates).
- [x] Templates tab renders both sections with sub-headings ("Chain templates",
  "Task templates").
- [x] Prop plumbing: page.tsx → BoardView → SettingsDialog.

## Task 3 — Task-create flow + help + wrap-up

- [x] `TaskDialog`: a "Start from template" select (create only, hidden when editing
  or when no templates exist). Picking one prefills title (with `{date}` →
  YYYY-MM-DD), description, priority, tag, notes, and — when a chain template is
  attached — the step builder. Prefill is a suggestion: every field stays editable,
  and re-picking another template overwrites the prefilled fields.
- [x] Help: Templates settings section documents task templates; remove the
  "🛣 On the roadmap (Epic S6)" callout.
- [x] Mark roadmap S6 shipped; full verification (`type-check`, `lint`, `bun test`);
  commits per task.

> **Implemented 2026-06-05.** Deviations: none of substance. The template picker
> lives at the top of the create dialog and resets when the dialog closes. `{date}`
> expansion happens client-side at pick time so the user sees (and can edit) the
> final title.
