import type { Metadata } from 'next'
import { HelpContent } from '@/components/help/help-content'

/**
 * E-1: /help is a SERVER-rendered route. The 3k+ lines of guide content live
 * in a server component (RSC payload / prerendered HTML), so they no longer
 * ship in any client JS bundle. The page sits inside the (board) route group,
 * whose client layout (BoardShell) stays mounted — navigating board → help →
 * board keeps project state alive; only the WebSocket pauses (it is
 * board-view-scoped) and reconnects on return.
 */
export const metadata: Metadata = {
  title: 'Help & User Guide — Conductor',
}

export default function HelpRoute() {
  return <HelpContent />
}
