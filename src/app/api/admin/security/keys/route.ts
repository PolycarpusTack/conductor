import { NextResponse } from 'next/server'

import { getLegacyApiKeyStatus, migrateLegacyApiKeys } from '@/lib/server/api-keys'
import { requireAdminSession } from '@/lib/server/admin-session'
import { withErrorHandling } from '@/lib/server/api-errors'

export const GET = withErrorHandling('api/admin/security/keys', async () => {
  const unauthorized = await requireAdminSession()
  if (unauthorized) return unauthorized
  return NextResponse.json(await getLegacyApiKeyStatus())
})

export const POST = withErrorHandling('api/admin/security/keys', async () => {
  const unauthorized = await requireAdminSession()
  if (unauthorized) return unauthorized
  return NextResponse.json(await migrateLegacyApiKeys())
})
