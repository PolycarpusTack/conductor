'use client'

import { Button } from '@/components/ui/button'
import { SkillsPage } from '@/components/skills-page'
import { useUiState } from '@/app/_views/board-context'

export default function SkillsRoute() {
  const { setView, currentWorkspaceId } = useUiState()

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div />
        <Button variant="outline" size="sm" onClick={() => setView('board')}>Back to Board</Button>
      </div>
      <SkillsPage workspaceId={currentWorkspaceId} />
    </div>
  )
}
