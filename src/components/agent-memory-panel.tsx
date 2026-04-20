'use client'

import { useCallback, useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { toast } from 'sonner'

type Memory = {
  id: string
  category: string
  content: string
  confidence: number
  reinforcement: number
  createdAt: string
  lastAccessed: string | null
}

export function AgentMemoryPanel({
  agentId,
  agentApiKey,
}: {
  agentId: string
  agentApiKey: string | null
}) {
  const [memories, setMemories] = useState<Memory[]>([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    if (!agentApiKey) return
    setLoading(true)
    try {
      const res = await fetch(`/api/agents/${agentId}/memories?limit=100`, {
        headers: { Authorization: `Bearer ${agentApiKey}` },
      })
      if (!res.ok) throw new Error(await res.text())
      const json = (await res.json()) as { data: Memory[]; total: number }
      setMemories(json.data)
    } catch (err) {
      toast.error(`Load failed: ${err instanceof Error ? err.message : 'unknown'}`)
    } finally {
      setLoading(false)
    }
  }, [agentId, agentApiKey])

  useEffect(() => { void load() }, [load])

  const remove = async (memoryId: string) => {
    if (!agentApiKey) return
    if (!confirm('Delete this memory?')) return
    const res = await fetch(`/api/agents/${agentId}/memories/${memoryId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${agentApiKey}` },
    })
    if (!res.ok) {
      const detail = await res.text().catch(() => 'unknown')
      toast.error(`Delete failed: ${detail}`)
      return
    }
    setMemories((prev) => prev.filter((m) => m.id !== memoryId))
  }

  if (!agentApiKey) {
    return (
      <div className="text-sm text-muted-foreground">
        Rotate the agent API key to view memories.
      </div>
    )
  }
  if (loading) return <div className="text-sm text-muted-foreground">Loading…</div>
  if (memories.length === 0) {
    return (
      <div className="text-sm text-muted-foreground">
        No memories yet. Agents write them via POST /api/agents/:id/memories.
      </div>
    )
  }

  return (
    <div className="space-y-2">
      {memories.map((m) => (
        <div key={m.id} className="flex items-start gap-2 rounded border p-2 text-sm">
          <span className="rounded bg-muted px-1.5 py-0.5 text-xs uppercase">{m.category}</span>
          <div className="flex-1">
            <div>{m.content}</div>
            <div className="text-xs text-muted-foreground mt-1">
              reinforced {m.reinforcement}x · {new Date(m.createdAt).toLocaleDateString()}
            </div>
          </div>
          <Button variant="ghost" size="sm" aria-label="Delete memory" onClick={() => remove(m.id)}>×</Button>
        </div>
      ))}
    </div>
  )
}
