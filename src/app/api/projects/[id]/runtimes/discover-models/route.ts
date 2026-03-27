import { NextResponse } from 'next/server'
import { requireAdminSession } from '@/lib/server/admin-session'

interface DiscoveredModel {
  id: string
  name: string
  tier: string
}

function classifyTier(modelId: string): string {
  const id = modelId.toLowerCase()
  if (id.includes('opus')) return 'deep'
  if (id.includes('sonnet')) return 'balanced'
  if (id.includes('haiku')) return 'fast'
  if (id.includes('gpt-4o-mini') || id.includes('gpt-4o-audio')) return 'fast'
  if (id.includes('gpt-4o') || id.includes('gpt-4.1')) return 'balanced'
  if (id.includes('gpt-4.5') || id.includes('o3') || id.includes('o1')) return 'deep'
  if (id.includes('gpt-3.5') || id.includes('gpt-4.1-mini') || id.includes('gpt-4.1-nano')) return 'fast'
  return 'balanced'
}

function formatModelName(modelId: string): string {
  return modelId
    .replace(/-\d{8}$/, '')
    .split('-')
    .map(part => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}

async function fetchAnthropicModels(apiKey: string): Promise<DiscoveredModel[]> {
  const res = await fetch('https://api.anthropic.com/v1/models', {
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
  })

  if (!res.ok) {
    const body = await res.text()
    throw new Error(`Anthropic API error ${res.status}: ${body}`)
  }

  const data = await res.json()
  const models = data.data || data.models || []

  return models
    .filter((m: { id: string }) => !m.id.includes('embed'))
    .map((m: { id: string; display_name?: string }) => ({
      id: m.id,
      name: m.display_name || formatModelName(m.id),
      tier: classifyTier(m.id),
    }))
    .sort((a: DiscoveredModel, b: DiscoveredModel) => {
      const tierOrder: Record<string, number> = { fast: 0, balanced: 1, smart: 2, deep: 3 }
      return (tierOrder[a.tier] || 1) - (tierOrder[b.tier] || 1)
    })
}

async function fetchZaiModels(apiKey: string): Promise<DiscoveredModel[]> {
  // Z.ai uses OpenAI-compatible API format
  const res = await fetch('https://api.z.ai/api/paas/v4/models', {
    headers: { Authorization: `Bearer ${apiKey}` },
  })

  if (!res.ok) {
    const body = await res.text()
    throw new Error(`Z.ai API error ${res.status}: ${body}`)
  }

  const data = await res.json()
  const models = data.data || data.models || []

  return models
    .filter((m: { id: string }) =>
      m.id.startsWith('glm-') || m.id.startsWith('cog') || m.id.includes('embedding')
    )
    .map((m: { id: string; owned_by?: string }) => ({
      id: m.id,
      name: formatModelName(m.id),
      tier: classifyZaiTier(m.id),
    }))
    .sort((a: DiscoveredModel, b: DiscoveredModel) => {
      const tierOrder: Record<string, number> = { fast: 0, balanced: 1, smart: 2, deep: 3 }
      return (tierOrder[a.tier] || 1) - (tierOrder[b.tier] || 1)
    })
}

function classifyZaiTier(modelId: string): string {
  const id = modelId.toLowerCase()
  if (id.includes('glm-5')) return 'deep'
  if (id.includes('glm-4.6')) return 'smart'
  if (id.includes('glm-4.5') || id.includes('glm-4v')) return 'balanced'
  if (id.includes('glm-4')) return 'balanced'
  if (id.includes('flash') || id.includes('lite')) return 'fast'
  return 'balanced'
}

async function fetchGoogleModels(apiKey: string): Promise<DiscoveredModel[]> {
  const res = await fetch(`https://generativelanguage.googleapis.com/v1/models?key=${apiKey}`)

  if (!res.ok) {
    const body = await res.text()
    throw new Error(`Google AI API error ${res.status}: ${body}`)
  }

  const data = await res.json()
  const models = data.models || []

  return models
    .filter((m: { name: string; supportedGenerationMethods?: string[] }) =>
      m.supportedGenerationMethods?.includes('generateContent')
    )
    .map((m: { name: string; displayName?: string }) => {
      const id = m.name.replace('models/', '')
      return {
        id,
        name: m.displayName || formatModelName(id),
        tier: classifyGoogleTier(id),
      }
    })
    .sort((a: DiscoveredModel, b: DiscoveredModel) => {
      const tierOrder: Record<string, number> = { fast: 0, balanced: 1, smart: 2, deep: 3 }
      return (tierOrder[a.tier] || 1) - (tierOrder[b.tier] || 1)
    })
}

function classifyGoogleTier(modelId: string): string {
  const id = modelId.toLowerCase()
  if (id.includes('flash')) return 'fast'
  if (id.includes('pro')) return 'balanced'
  if (id.includes('ultra')) return 'deep'
  return 'balanced'
}

async function fetchOpenAIModels(apiKey: string): Promise<DiscoveredModel[]> {
  const res = await fetch('https://api.openai.com/v1/models', {
    headers: { Authorization: `Bearer ${apiKey}` },
  })

  if (!res.ok) {
    throw new Error(`OpenAI API error ${res.status}`)
  }

  const data = await res.json()
  const models = data.data || []

  return models
    .filter((m: { id: string }) =>
      m.id.startsWith('gpt-') || m.id.startsWith('o1') || m.id.startsWith('o3') || m.id.startsWith('o4')
    )
    .map((m: { id: string }) => ({
      id: m.id,
      name: formatModelName(m.id),
      tier: classifyTier(m.id),
    }))
    .sort((a: DiscoveredModel, b: DiscoveredModel) => a.name.localeCompare(b.name))
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const unauthorized = await requireAdminSession()
    if (unauthorized) return unauthorized

    await params

    const body = await request.json()
    const { adapter, apiKeyEnvVar } = body

    if (!adapter || typeof adapter !== 'string') {
      return NextResponse.json({ error: 'Adapter is required' }, { status: 400 })
    }

    if (!apiKeyEnvVar || typeof apiKeyEnvVar !== 'string') {
      return NextResponse.json({ error: 'API key environment variable name is required' }, { status: 400 })
    }

    const apiKey = process.env[apiKeyEnvVar]
    if (!apiKey) {
      return NextResponse.json(
        { error: `Environment variable "${apiKeyEnvVar}" is not set on the server` },
        { status: 400 },
      )
    }

    let models: DiscoveredModel[] = []

    switch (adapter) {
      case 'anthropic':
        models = await fetchAnthropicModels(apiKey)
        break
      case 'openai':
        models = await fetchOpenAIModels(apiKey)
        break
      case 'z-ai':
        models = await fetchZaiModels(apiKey)
        break
      case 'google':
        models = await fetchGoogleModels(apiKey)
        break
      default:
        return NextResponse.json(
          { error: `Model discovery is not supported for "${adapter}". Add models manually.` },
          { status: 400 },
        )
    }

    return NextResponse.json({ models })
  } catch (error) {
    console.error('Error discovering models:', error)
    const message = error instanceof Error ? error.message : 'Failed to discover models'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
