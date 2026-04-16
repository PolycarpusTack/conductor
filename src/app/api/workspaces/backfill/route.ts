import { NextResponse } from 'next/server'

import { requireAdminSession } from '@/lib/server/admin-session'
import { backfillProjectWorkspaces } from '@/lib/server/workspace'

export async function POST() {
  try {
    const unauthorized = await requireAdminSession()
    if (unauthorized) return unauthorized

    const count = await backfillProjectWorkspaces()

    return NextResponse.json({
      backfilled: count,
      message: count > 0
        ? `Assigned ${count} project(s) to the default workspace.`
        : 'All projects already have a workspace.',
    })
  } catch (error) {
    console.error('Backfill error:', error)
    return NextResponse.json({ error: 'Failed to backfill workspaces' }, { status: 500 })
  }
}
