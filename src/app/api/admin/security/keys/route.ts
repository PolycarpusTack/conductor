import { NextResponse } from 'next/server'

import { getLegacyApiKeyStatus, migrateLegacyApiKeys } from '@/lib/server/api-keys'
import { requireAdminSession } from '@/lib/server/admin-session'

export async function GET() {
  try {
    const unauthorized = await requireAdminSession()
    if (unauthorized) {
      return unauthorized
    }

    return NextResponse.json(await getLegacyApiKeyStatus())
  } catch (error) {
    console.error('Error fetching API key migration status:', error)
    return NextResponse.json({ error: 'Failed to fetch API key migration status' }, { status: 500 })
  }
}

export async function POST() {
  try {
    const unauthorized = await requireAdminSession()
    if (unauthorized) {
      return unauthorized
    }

    return NextResponse.json(await migrateLegacyApiKeys())
  } catch (error) {
    console.error('Error migrating legacy API keys:', error)
    return NextResponse.json({ error: 'Failed to migrate legacy API keys' }, { status: 500 })
  }
}
