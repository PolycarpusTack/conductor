import { cn } from '@/lib/utils'

export type AgentBadgeAgent = {
  name: string
  emoji: string
  color?: string | null
  role?: string | null
  personality?: string | null
}

type Size = 'compact' | 'card' | 'full'

type AgentBadgeProps = {
  agent: AgentBadgeAgent
  size?: Size
  className?: string
  /**
   * When true, truncate personality with a tooltip for full text.
   * Default: true when size is 'card', false otherwise.
   */
  truncatePersonality?: boolean
}

/**
 * Append an alpha hex (default `22` ≈ 13%) to a 6-digit `#RRGGBB` color.
 * Falls back to the raw color string when the format isn't safe to extend,
 * so the browser at worst renders the solid color instead of dropping the style.
 */
function withAlpha(hex: string, alpha: string = '22'): string {
  const h = hex.startsWith('#') ? hex : `#${hex}`
  return /^#[0-9a-fA-F]{6}$/.test(h) ? `${h}${alpha}` : h
}

/**
 * Unified agent display.
 *
 * - `compact` — emoji only with a color dot; name in tooltip. Used in tight spaces like kanban card corners.
 * - `card` — emoji + name + role chip. Used in Select options, small cards.
 * - `full` — emoji + name + role chip + personality line underneath. Used in the agent list page, task-detail drawer.
 */
export function AgentBadge({ agent, size = 'card', className, truncatePersonality }: AgentBadgeProps) {
  const color = agent.color || '#3b82f6'
  const truncate = truncatePersonality ?? (size === 'card')

  if (size === 'compact') {
    return (
      <span
        className={cn('inline-flex items-center gap-1 text-[11px]', className)}
        role="img"
        aria-label={agent.name}
        title={agent.name}
      >
        <span
          aria-hidden
          className="h-1.5 w-1.5 rounded-full"
          style={{ backgroundColor: color }}
        />
        <span aria-hidden>{agent.emoji}</span>
      </span>
    )
  }

  return (
    <span className={cn('inline-flex flex-col gap-0.5', className)}>
      <span className="inline-flex items-center gap-1.5">
        <span aria-hidden className="text-base leading-none">{agent.emoji}</span>
        <span className="font-medium text-sm leading-tight">{agent.name}</span>
        {agent.role ? (
          <span
            className="rounded-full px-1.5 py-0.5 text-[10px] uppercase tracking-wide"
            style={{ backgroundColor: withAlpha(color), color }}
          >
            {agent.role}
          </span>
        ) : null}
      </span>
      {size === 'full' && agent.personality ? (
        <span
          className={cn('text-xs text-muted-foreground italic', truncate && 'line-clamp-1')}
          title={truncate ? agent.personality : undefined}
        >
          {agent.personality}
        </span>
      ) : null}
    </span>
  )
}
