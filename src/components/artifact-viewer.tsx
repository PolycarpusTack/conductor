'use client'

import { useState } from 'react'
import { ChevronDown, ChevronUp, ExternalLink, FileText, Code, Image, Link2, FileJson, Terminal } from 'lucide-react'

interface StepArtifact {
  id: string
  type: string
  label: string
  content?: string | null
  url?: string | null
  mimeType?: string | null
  metadata?: string | null
  createdAt: string
}

interface ArtifactViewerProps {
  artifacts: StepArtifact[]
}

const TYPE_CONFIG: Record<string, { icon: typeof FileText; color: string }> = {
  text: { icon: FileText, color: 'text-muted-foreground' },
  code: { icon: Code, color: 'text-[var(--op-blue,#60A5FA)]' },
  diff: { icon: Code, color: 'text-[var(--op-green,#4ADE80)]' },
  url: { icon: Link2, color: 'text-[var(--op-teal,#2DD4BF)]' },
  image: { icon: Image, color: 'text-[var(--op-purple,#A78BFA)]' },
  file: { icon: FileText, color: 'text-[var(--op-amber,#F59E0B)]' },
  json: { icon: FileJson, color: 'text-[var(--op-blue,#60A5FA)]' },
  log: { icon: Terminal, color: 'text-muted-foreground' },
  test_result: { icon: Terminal, color: 'text-[var(--op-teal,#2DD4BF)]' },
}

function formatJson(content: string): string | null {
  try {
    return JSON.stringify(JSON.parse(content), null, 2)
  } catch {
    return null
  }
}

function ArtifactContent({ artifact }: { artifact: StepArtifact }) {
  const [expanded, setExpanded] = useState(false)

  switch (artifact.type) {
    case 'image':
      if (artifact.url) {
        return (
          <div className="mt-1">
            <img
              src={artifact.url}
              alt={artifact.label}
              className="max-w-full max-h-[200px] rounded border border-border/20 object-contain"
            />
          </div>
        )
      }
      return null

    case 'url':
      return (
        <a
          href={artifact.url || artifact.content || '#'}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-1 text-xs text-[var(--op-teal)] hover:underline mt-1"
        >
          {artifact.url || artifact.content}
          <ExternalLink className="h-3 w-3" />
        </a>
      )

    case 'code':
    case 'diff': {
      const content = artifact.content || ''
      const lines = content.split('\n')
      const isLong = lines.length > 20

      return (
        <div className="mt-1">
          <pre className={`text-[10px] font-mono leading-relaxed bg-card/50 border border-border/20 rounded p-2 overflow-x-auto ${
            isLong && !expanded ? 'max-h-[200px] overflow-y-hidden' : ''
          }`}>
            {artifact.type === 'diff' ? (
              lines.map((line, i) => (
                <div
                  key={i}
                  className={
                    line.startsWith('+') ? 'text-[var(--op-green)]' :
                    line.startsWith('-') ? 'text-[var(--op-red)]' :
                    line.startsWith('@@') ? 'text-[var(--op-blue)]' :
                    ''
                  }
                >
                  {line}
                </div>
              ))
            ) : (
              content
            )}
          </pre>
          {isLong && (
            <button
              onClick={() => setExpanded(!expanded)}
              className="text-[10px] font-mono text-muted-foreground/60 hover:text-muted-foreground mt-1"
            >
              {expanded ? 'Show less' : `Show all ${lines.length} lines`}
            </button>
          )}
        </div>
      )
    }

    case 'json': {
      const content = artifact.content || ''
      const formatted = formatJson(content)

      if (formatted === null) {
        return (
          <pre className="text-[10px] font-mono leading-relaxed bg-card/50 border border-border/20 rounded p-2 overflow-x-auto mt-1 max-h-[200px] overflow-y-auto">
            {content}
          </pre>
        )
      }

      const lines = formatted.split('\n')
      const isLong = lines.length > 15

      return (
        <div className="mt-1">
          <pre className={`text-[10px] font-mono leading-relaxed bg-card/50 border border-border/20 rounded p-2 overflow-x-auto ${
            isLong && !expanded ? 'max-h-[160px] overflow-y-hidden' : ''
          }`}>
            {formatted}
          </pre>
          {isLong && (
            <button
              onClick={() => setExpanded(!expanded)}
              className="text-[10px] font-mono text-muted-foreground/60 hover:text-muted-foreground mt-1"
            >
              {expanded ? 'Show less' : `Show all ${lines.length} lines`}
            </button>
          )}
        </div>
      )
    }

    case 'test_result': {
      const content = artifact.content || ''
      return (
        <div className="mt-1">
          <pre className="text-[10px] font-mono leading-relaxed bg-card/50 border border-border/20 rounded p-2 overflow-x-auto max-h-[200px] overflow-y-auto">
            {content.split('\n').map((line, i) => (
              <div
                key={i}
                className={
                  line.includes('PASS') || line.includes('pass') || line.includes('ok') ? 'text-[var(--op-green)]' :
                  line.includes('FAIL') || line.includes('fail') || line.includes('error') ? 'text-[var(--op-red)]' :
                  ''
                }
              >
                {line}
              </div>
            ))}
          </pre>
        </div>
      )
    }

    case 'text':
    case 'log':
    default:
      return (
        <div className="mt-1">
          <pre className="text-[10px] font-mono leading-relaxed bg-card/50 border border-border/20 rounded p-2 overflow-x-auto max-h-[200px] overflow-y-auto whitespace-pre-wrap">
            {artifact.content}
          </pre>
        </div>
      )
  }
}

export function ArtifactViewer({ artifacts }: ArtifactViewerProps) {
  const [expanded, setExpanded] = useState(false)

  if (artifacts.length === 0) return null

  return (
    <div className="rounded-md border border-border/20 bg-card/20 p-3">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between"
      >
        <div className="text-[10px] font-mono font-semibold text-muted-foreground">
          ARTIFACTS ({artifacts.length})
        </div>
        {expanded
          ? <ChevronUp className="h-3 w-3 text-muted-foreground" />
          : <ChevronDown className="h-3 w-3 text-muted-foreground" />
        }
      </button>

      {expanded && (
        <div className="mt-2 space-y-3">
          {artifacts.map(artifact => {
            const config = TYPE_CONFIG[artifact.type] || TYPE_CONFIG.text
            const Icon = config.icon

            return (
              <div key={artifact.id}>
                <div className="flex items-center gap-2">
                  <Icon className={`h-3 w-3 ${config.color}`} />
                  <span className="text-xs font-medium">{artifact.label}</span>
                  <span className="text-[9px] font-mono text-muted-foreground/50 px-1.5 py-0.5 rounded bg-muted/30">
                    {artifact.type}
                  </span>
                </div>
                <ArtifactContent artifact={artifact} />
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
