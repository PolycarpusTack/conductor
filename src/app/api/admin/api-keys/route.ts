import { NextResponse } from 'next/server'
import { z } from 'zod'

import { assertSameOrigin } from '@/lib/csrf'
import { db } from '@/lib/db'
import { requireAdminSession } from '@/lib/server/admin-session'
import { badRequest, notFound, withErrorHandling } from '@/lib/server/api-errors'
import { issueApiKey, listApiKeys, revokeApiKey } from '@/lib/server/scoped-api-keys'

const issueSchema = z.object({
  label: z.string().trim().min(1).max(100),
  scopes: z.array(z.string().trim().min(1)).min(1),
  // B-4: binds the key to one project; omitted = legacy instance-wide key
  // (deprecated migration path).
  projectId: z.string().trim().min(1).optional(),
})

/** GET /api/admin/api-keys — list issued keys (prefixes only, never hashes) */
export const GET = withErrorHandling('api/admin/api-keys', async () => {
  const unauthorized = await requireAdminSession()
  if (unauthorized) return unauthorized

  return NextResponse.json({ keys: await listApiKeys() })
})

/** POST /api/admin/api-keys — issue a new scoped key; the raw key is returned once */
export const POST = withErrorHandling('api/admin/api-keys', async (request: Request) => {
  const unauthorized = await requireAdminSession()
  if (unauthorized) return unauthorized
  assertSameOrigin(request)

  const parsed = issueSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    throw badRequest(parsed.error.issues[0]?.message || 'Invalid API key payload')
  }

  const { label, scopes, projectId } = parsed.data

  if (projectId) {
    const project = await db.project.findUnique({ where: { id: projectId }, select: { id: true } })
    if (!project) throw badRequest('Unknown projectId — the key must be bound to an existing project')
  }

  const { id, rawKey } = await issueApiKey(label, scopes, projectId ?? null)

  return NextResponse.json({ id, rawKey }, { status: 201 })
})

/** DELETE /api/admin/api-keys?id=… — revoke a key (kept in the list for audit) */
export const DELETE = withErrorHandling('api/admin/api-keys', async (request: Request) => {
  const unauthorized = await requireAdminSession()
  if (unauthorized) return unauthorized
  assertSameOrigin(request)

  const id = new URL(request.url).searchParams.get('id')
  if (!id) throw badRequest('Missing id query parameter')

  const revoked = await revokeApiKey(id)
  if (!revoked) throw notFound('API key not found')

  return NextResponse.json({ success: true })
})
