'use client'

import { useState, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Textarea } from '@/components/ui/textarea'
import { Search, Plus, BookOpen, Sparkles, X } from 'lucide-react'

interface Skill {
  id: string
  title: string
  description?: string | null
  tags: string[]
  version: number
  sourceTaskId?: string | null
  workspaceId: string
  createdAt: string
  updatedAt?: string
  body?: string
  score?: number | null
}

interface SkillsPageProps {
  workspaceId?: string | null
}

async function loadSkills(workspaceId?: string | null): Promise<Skill[]> {
  const params = new URLSearchParams()
  if (workspaceId) params.set('workspaceId', workspaceId)
  const res = await fetch(`/api/skills?${params}`).catch(() => null)
  if (!res?.ok) return []
  const data = await res.json()
  return data.data || []
}

export function SkillsPage({ workspaceId }: SkillsPageProps) {
  const [skills, setSkills] = useState<Skill[]>([])
  const [loading, setLoading] = useState(true)
  const [query, setQuery] = useState('')
  const [searchResults, setSearchResults] = useState<Skill[] | null>(null)
  const [searchMethod, setSearchMethod] = useState<string | null>(null)
  const [selectedSkill, setSelectedSkill] = useState<Skill | null>(null)
  const [createOpen, setCreateOpen] = useState(false)
  // G3-2-T2: the dialog doubles as the editor — editingId set = PUT mode.
  const [editingId, setEditingId] = useState<string | null>(null)
  const [newTitle, setNewTitle] = useState('')
  const [newDescription, setNewDescription] = useState('')
  const [newBody, setNewBody] = useState('')
  const [newTags, setNewTags] = useState('')
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const data = await loadSkills(workspaceId)
      if (cancelled) return
      setSkills(data)
      setLoading(false)
    })()
    return () => { cancelled = true }
  }, [workspaceId])

  const handleSearch = async () => {
    if (!query.trim()) { setSearchResults(null); return }
    const params = new URLSearchParams({ q: query })
    if (workspaceId) params.set('workspaceId', workspaceId)
    const res = await fetch(`/api/skills/search?${params}`).catch(() => null)
    if (res?.ok) {
      const data = await res.json()
      setSearchResults(data.data || [])
      setSearchMethod(data.method || null)
    }
  }

  const resetDialog = () => {
    setCreateOpen(false)
    setEditingId(null)
    setNewTitle('')
    setNewDescription('')
    setNewBody('')
    setNewTags('')
  }

  const handleSave = async () => {
    if (!newTitle.trim() || !newBody.trim()) return
    setSaving(true)
    const isEdit = editingId !== null
    const res = await fetch(isEdit ? `/api/skills/${editingId}` : '/api/skills', {
      method: isEdit ? 'PUT' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: newTitle.trim(),
        description: newDescription.trim() || (isEdit ? null : undefined),
        body: newBody,
        tags: newTags ? newTags.split(',').map((t) => t.trim()).filter(Boolean) : isEdit ? null : undefined,
        ...(isEdit ? {} : { workspaceId }),
      }),
    })
    if (res.ok) {
      resetDialog()
      setSelectedSkill(null)
      setSearchResults(null)
      setSkills(await loadSkills(workspaceId))
    }
    setSaving(false)
  }

  const startEdit = (skill: Skill) => {
    setEditingId(skill.id)
    setNewTitle(skill.title)
    setNewDescription(skill.description || '')
    setNewBody(skill.body || '')
    setNewTags(skill.tags.join(', '))
    setSelectedSkill(null)
    setCreateOpen(true)
  }

  const handleDelete = async (skillId: string) => {
    setDeleting(true)
    const res = await fetch(`/api/skills/${skillId}`, { method: 'DELETE' })
    if (res.ok) {
      setSelectedSkill(null)
      setSearchResults(null)
      setSkills(await loadSkills(workspaceId))
    }
    setDeleting(false)
  }

  const fetchSkillBody = async (skillId: string) => {
    // G3-2-T2: full detail (incl. body) from the new GET /api/skills/:id.
    const res = await fetch(`/api/skills/${skillId}`).catch(() => null)
    if (res?.ok) {
      setSelectedSkill(await res.json())
      return
    }
    setSelectedSkill(skills.find((s) => s.id === skillId) || null)
  }

  const displaySkills = searchResults ?? skills

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <BookOpen className="w-5 h-5 text-muted-foreground" />
          <h2 className="text-lg font-semibold">Skills Library</h2>
          <Badge variant="secondary" className="text-xs">{skills.length}</Badge>
        </div>
        <Button size="sm" onClick={() => setCreateOpen(true)}>
          <Plus className="w-3.5 h-3.5 mr-1.5" />
          New Skill
        </Button>
      </div>

      {/* Search */}
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
            placeholder="Search skills (semantic on Postgres+pgvector, text match otherwise)..."
            className="pl-9"
          />
        </div>
        <Button variant="outline" onClick={handleSearch}>Search</Button>
        {searchResults && (
          <Button variant="ghost" size="icon" onClick={() => { setSearchResults(null); setQuery('') }}>
            <X className="w-4 h-4" />
          </Button>
        )}
      </div>

      {searchResults && searchMethod && (
        <p className="text-xs text-muted-foreground">
          {searchResults.length} result{searchResults.length !== 1 ? 's' : ''} via {searchMethod} search
        </p>
      )}

      {/* Skills grid */}
      {loading ? (
        <div className="flex items-center justify-center h-32 text-muted-foreground text-sm">
          Loading skills...
        </div>
      ) : displaySkills.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <Sparkles className="w-8 h-8 mx-auto mb-3 text-muted-foreground/30" />
            <p className="text-sm text-muted-foreground">
              {searchResults ? 'No matching skills found.' : 'No skills yet. Create one or save a completed task as a skill.'}
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {displaySkills.map((skill) => (
            <Card
              key={skill.id}
              className="cursor-pointer hover:border-primary/30 transition-colors"
              onClick={() => fetchSkillBody(skill.id)}
            >
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium leading-tight">{skill.title}</CardTitle>
                {skill.description && (
                  <p className="text-xs text-muted-foreground line-clamp-2">{skill.description}</p>
                )}
              </CardHeader>
              <CardContent className="pt-0">
                <div className="flex flex-wrap gap-1">
                  {skill.tags.map((tag) => (
                    <Badge key={tag} variant="secondary" className="text-[10px]">{tag}</Badge>
                  ))}
                </div>
                {skill.score != null && (
                  <p className="text-[10px] text-muted-foreground mt-2">
                    Relevance: {(skill.score * 100).toFixed(0)}%
                  </p>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Skill detail dialog */}
      <Dialog open={!!selectedSkill} onOpenChange={(open) => { if (!open) setSelectedSkill(null) }}>
        <DialogContent className="sm:max-w-[600px] max-h-[80vh] overflow-y-auto">
          {selectedSkill && (
            <>
              <DialogHeader>
                <DialogTitle>{selectedSkill.title}</DialogTitle>
                {selectedSkill.description && (
                  <DialogDescription>{selectedSkill.description}</DialogDescription>
                )}
              </DialogHeader>
              <div className="space-y-3">
                <div className="flex flex-wrap gap-1">
                  {selectedSkill.tags.map((tag) => (
                    <Badge key={tag} variant="secondary">{tag}</Badge>
                  ))}
                </div>
                <Separator />
                <div className="prose prose-sm dark:prose-invert max-w-none whitespace-pre-wrap text-sm">
                  {selectedSkill.body || ''}
                </div>
              </div>
              <DialogFooter>
                <Button
                  variant="destructive"
                  onClick={() => handleDelete(selectedSkill.id)}
                  disabled={deleting}
                >
                  {deleting ? 'Deleting…' : 'Delete'}
                </Button>
                <Button variant="outline" onClick={() => startEdit(selectedSkill)}>
                  Edit
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* Create/edit skill dialog */}
      <Dialog open={createOpen} onOpenChange={(open) => { if (!open) resetDialog() }}>
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle>{editingId ? 'Edit Skill' : 'Create Skill'}</DialogTitle>
            <DialogDescription>
              Skills are reusable playbooks — attach them to agents and they ride the system prompt on every run.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <label className="text-sm font-medium">Title</label>
              <Input value={newTitle} onChange={(e) => setNewTitle(e.target.value)} placeholder="Deploy to staging" />
            </div>
            <div className="grid gap-2">
              <label className="text-sm font-medium">Description</label>
              <Input value={newDescription} onChange={(e) => setNewDescription(e.target.value)} placeholder="Step-by-step staging deploy..." />
            </div>
            <div className="grid gap-2">
              <label className="text-sm font-medium">Body (Markdown)</label>
              <Textarea value={newBody} onChange={(e) => setNewBody(e.target.value)} placeholder="## Steps&#10;1. Run tests&#10;2. Build&#10;3. Deploy" rows={8} />
            </div>
            <div className="grid gap-2">
              <label className="text-sm font-medium">Tags (comma-separated)</label>
              <Input value={newTags} onChange={(e) => setNewTags(e.target.value)} placeholder="deploy, staging, ci" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={resetDialog}>Cancel</Button>
            <Button onClick={handleSave} disabled={saving || !newTitle.trim() || !newBody.trim()}>
              {saving ? 'Saving...' : editingId ? 'Save Changes' : 'Create Skill'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
