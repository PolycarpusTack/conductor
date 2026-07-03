'use client'

import { Button } from '@/components/ui/button'
import { RuntimeDashboard } from '@/components/runtime-dashboard'
import { useUiState, useLiveAgentLogs } from '@/app/_views/board-context'

export default function RuntimePage() {
  const { setView } = useUiState()
  const liveAgentLogs = useLiveAgentLogs()

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-lg font-semibold">Runtime Dashboard</h2>
        <Button variant="outline" size="sm" onClick={() => setView('board')}>Back to Board</Button>
      </div>
      <RuntimeDashboard liveAgentLogs={liveAgentLogs} />
    </div>
  )
}
