import type { ViewType } from './board-context'

/**
 * E-1: canonical mapping between logical views and URL paths.
 *
 * The app previously switched views with a `useState<ViewType>` in page.tsx;
 * views are now real routes and `setView` (kept in UiStateContext for
 * compatibility) is a thin wrapper over `router.push(viewToPath(view))`.
 */
export const VIEW_PATHS: Record<ViewType, string> = {
  landing: '/',
  board: '/board',
  runtime: '/runtime',
  skills: '/skills',
  help: '/help',
}

export function viewToPath(view: ViewType): string {
  return VIEW_PATHS[view]
}

/**
 * Derive the logical view from a pathname. Only meaningful inside the
 * `(board)` route group ('/board' | '/runtime' | '/skills' | '/help');
 * anything else falls back to 'board'.
 */
export function viewFromPathname(pathname: string | null): ViewType {
  switch (pathname) {
    case '/':
      return 'landing'
    case '/runtime':
      return 'runtime'
    case '/skills':
      return 'skills'
    case '/help':
      return 'help'
    default:
      return 'board'
  }
}
