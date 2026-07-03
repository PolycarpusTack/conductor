import { NextResponse } from 'next/server'

import { assertSameOrigin } from '@/lib/csrf'
import { requireAdminSession } from '@/lib/server/admin-session'
import { badRequest, withErrorHandling } from '@/lib/server/api-errors'
import { importProjectBundle, projectImportBundleSchema } from '@/lib/server/project-export'

/**
 * POST /api/projects/import — create a NEW project from an export bundle.
 * Validates the bundle shape (unknown keys such as an injected apiKey are
 * stripped by zod), remaps every internal id, and never writes a secret.
 * Body: { bundle } (or the bare bundle object).
 */
export const POST = withErrorHandling('api/projects/import', async (request: Request) => {
  const unauthorized = await requireAdminSession()
  if (unauthorized) return unauthorized
  assertSameOrigin(request)

  const body = await request.json().catch(() => ({}))
  const candidate =
    body && typeof body === 'object' && 'bundle' in body ? (body as { bundle: unknown }).bundle : body

  const parsed = projectImportBundleSchema.safeParse(candidate)
  if (!parsed.success) {
    throw badRequest(parsed.error.issues[0]?.message || 'Invalid project bundle')
  }

  const workspaceId =
    body && typeof body === 'object' && 'workspaceId' in body
      ? String((body as { workspaceId: unknown }).workspaceId)
      : undefined

  const result = await importProjectBundle(parsed.data, { workspaceId })

  return NextResponse.json(result, { status: 201 })
})
