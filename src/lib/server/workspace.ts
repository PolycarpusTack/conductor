import { randomUUID } from 'crypto'

import { db } from '@/lib/db'

const DEFAULT_WORKSPACE_SLUG = 'default'

export async function ensureDefaultWorkspace(): Promise<string> {
  const existing = await db.workspace.findUnique({
    where: { slug: DEFAULT_WORKSPACE_SLUG },
    select: { id: true },
  })

  if (existing) return existing.id

  const workspace = await db.workspace.create({
    data: {
      id: randomUUID(),
      slug: DEFAULT_WORKSPACE_SLUG,
      name: 'Default Workspace',
    },
  })

  return workspace.id
}

export async function backfillProjectWorkspaces(): Promise<number> {
  const defaultId = await ensureDefaultWorkspace()

  const orphans = await db.project.findMany({
    where: { workspaceId: null },
    select: { id: true },
  })

  if (orphans.length === 0) return 0

  await db.project.updateMany({
    where: { workspaceId: null },
    data: { workspaceId: defaultId },
  })

  return orphans.length
}

export async function getWorkspaces() {
  return db.workspace.findMany({
    select: {
      id: true,
      slug: true,
      name: true,
      createdAt: true,
      _count: { select: { projects: true, daemons: true } },
    },
    orderBy: { createdAt: 'asc' },
  })
}

export async function getWorkspaceBySlug(slug: string) {
  return db.workspace.findUnique({
    where: { slug },
    select: {
      id: true,
      slug: true,
      name: true,
      createdAt: true,
    },
  })
}

export async function requireWorkspaceId(workspaceId?: string | null): Promise<string> {
  if (workspaceId) return workspaceId
  return ensureDefaultWorkspace()
}
