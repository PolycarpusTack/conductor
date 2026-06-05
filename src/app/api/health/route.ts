import { NextResponse } from 'next/server'
import { getHealthStatus } from '@/lib/server/health'

// No auth — this endpoint is called by load balancers and monitoring tools.
// getHealthStatus returns structure only (no secrets, no connection strings).
export async function GET() {
  const health = await getHealthStatus()
  return NextResponse.json(health, { status: health.status === 'ok' ? 200 : 503 })
}
