import { NextResponse } from 'next/server'
import { validateLibraryPath, listEntries } from '@/lib/server/prompt-library'

/** GET /api/prompt-library — returns all archive entries grouped by category */
export async function GET() {
  const error = validateLibraryPath()
  if (error) {
    return NextResponse.json({ error }, { status: 503 })
  }

  try {
    const data = listEntries()
    return NextResponse.json(data)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unexpected error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
