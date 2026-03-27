import { createHmac, timingSafeEqual } from 'crypto'

type RealtimeTokenPayload = {
  projectId: string
  exp: number
}

function getRealtimeSecret() {
  return process.env.AGENTBOARD_WS_SECRET || null
}

function getInternalBroadcastSecret() {
  return process.env.AGENTBOARD_WS_INTERNAL_SECRET || null
}

function base64UrlEncode(value: string) {
  return Buffer.from(value).toString('base64url')
}

function base64UrlDecode(value: string) {
  return Buffer.from(value, 'base64url').toString('utf8')
}

function sign(value: string, secret: string) {
  return createHmac('sha256', secret).update(value).digest('base64url')
}

export function isRealtimeConfigured() {
  return Boolean(getRealtimeSecret())
}

export function createRealtimeToken(projectId: string, ttlSeconds = 60 * 10) {
  const secret = getRealtimeSecret()

  if (!secret) {
    throw new Error('Realtime secret is not configured')
  }

  const payload: RealtimeTokenPayload = {
    projectId,
    exp: Math.floor(Date.now() / 1000) + ttlSeconds,
  }

  const encodedPayload = base64UrlEncode(JSON.stringify(payload))
  const signature = sign(encodedPayload, secret)
  return `${encodedPayload}.${signature}`
}

export function verifyRealtimeToken(token: string) {
  const secret = getRealtimeSecret()

  if (!secret) {
    return null
  }

  const [encodedPayload, providedSignature] = token.split('.')
  if (!encodedPayload || !providedSignature) {
    return null
  }

  const expectedSignature = sign(encodedPayload, secret)
  const providedBuffer = Buffer.from(providedSignature)
  const expectedBuffer = Buffer.from(expectedSignature)

  if (
    providedBuffer.length !== expectedBuffer.length ||
    !timingSafeEqual(providedBuffer, expectedBuffer)
  ) {
    return null
  }

  try {
    const payload = JSON.parse(base64UrlDecode(encodedPayload)) as RealtimeTokenPayload
    if (!payload.projectId || typeof payload.exp !== 'number') {
      return null
    }

    if (payload.exp < Math.floor(Date.now() / 1000)) {
      return null
    }

    return payload
  } catch {
    return null
  }
}

export async function broadcastProjectEvent(
  projectId: string,
  event: string,
  payload: unknown,
) {
  const wsUrl = process.env.AGENTBOARD_WS_URL || 'http://127.0.0.1:3003'
  const internalSecret = getInternalBroadcastSecret()

  if (!internalSecret) {
    return
  }

  try {
    const response = await fetch(`${wsUrl.replace(/\/$/, '')}/broadcast`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${internalSecret}`,
      },
      body: JSON.stringify({
        projectId,
        event,
        payload,
      }),
      cache: 'no-store',
    })

    if (!response.ok) {
      console.error('Failed to broadcast realtime event:', response.status, response.statusText)
    }
  } catch (error) {
    console.error('Failed to broadcast realtime event:', error)
  }
}
