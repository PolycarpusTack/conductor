import { BoardShell } from '../_views/board-shell'

/**
 * E-1: shared layout for the routed app views (/board, /runtime, /skills,
 * /help). BoardShell is a client component that runs the state hooks, the
 * auth gate, and the WebSocket exactly once; Next keeps layouts mounted
 * across sibling navigation, so board state survives route changes.
 *
 * Pages under this group may still be server components (/help is): they are
 * passed to the client shell as `children`.
 */
export default function BoardGroupLayout({ children }: { children: React.ReactNode }) {
  return <BoardShell>{children}</BoardShell>
}
