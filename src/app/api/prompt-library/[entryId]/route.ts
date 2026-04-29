import { NextResponse } from 'next/server'
import { validateLibraryPath, getEntry } from '@/lib/server/prompt-library'

interface Params {
  params: Promise<{ entryId: string }>
}

/** GET /api/prompt-library/[entryId] — returns full content of one archive entry */
export async function GET(_req: Request, { params }: Params) {
  const error = validateLibraryPath()
  if (error) {
    return NextResponse.json({ error }, { status: 503 })
  }

  const { entryId } = await params
  const entry = getEntry(entryId)

  if (!entry) {
    return NextResponse.json({ error: 'Entry not found' }, { status: 404 })
  }

  return NextResponse.json({ entry })
}
