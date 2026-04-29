import { NextResponse } from 'next/server'
import { requireAdminSession } from '@/lib/server/admin-session'
import { validateLibraryPath, getEntry } from '@/lib/server/prompt-library'

interface Params {
  params: Promise<{ entryId: string }>
}

/** GET /api/prompt-library/[entryId] — returns full content of one archive entry */
export async function GET(_req: Request, { params }: Params) {
  const unauthorized = await requireAdminSession()
  if (unauthorized) return unauthorized

  const error = validateLibraryPath()
  if (error) {
    return NextResponse.json({ error }, { status: 503 })
  }

  try {
    const { entryId } = await params
    const entry = getEntry(entryId)

    if (!entry) {
      return NextResponse.json({ error: 'Entry not found' }, { status: 404 })
    }

    return NextResponse.json({ entry })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unexpected error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
