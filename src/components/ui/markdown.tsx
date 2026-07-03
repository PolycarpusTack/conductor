'use client'

import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { cn } from '@/lib/utils'

interface MarkdownProps {
  children: string
  /** Extra classes for the wrapper — e.g. `text-xs` to shrink the base size. */
  className?: string
}

/**
 * Shared markdown renderer for user/agent-authored text (descriptions, notes,
 * step output). Plain text renders unchanged: paragraphs keep their line
 * breaks via `whitespace-pre-wrap`, so this is a strict superset of the old
 * pre-wrap rendering. Styled to match the drawer's muted-foreground typography.
 */
export function Markdown({ children, className }: MarkdownProps) {
  return (
    <div className={cn('text-sm text-muted-foreground leading-relaxed space-y-2 break-words', className)}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          p: ({ children }) => <p className="whitespace-pre-wrap leading-relaxed">{children}</p>,
          h1: ({ children }) => <h1 className="text-[1.1em] font-semibold text-foreground mt-3 first:mt-0">{children}</h1>,
          h2: ({ children }) => <h2 className="text-[1.05em] font-semibold text-foreground mt-3 first:mt-0">{children}</h2>,
          h3: ({ children }) => <h3 className="font-semibold text-foreground mt-2 first:mt-0">{children}</h3>,
          h4: ({ children }) => <h4 className="font-medium text-foreground mt-2 first:mt-0">{children}</h4>,
          h5: ({ children }) => <h5 className="font-medium text-foreground">{children}</h5>,
          h6: ({ children }) => <h6 className="font-medium text-foreground">{children}</h6>,
          ul: ({ children }) => <ul className="list-disc pl-5 space-y-1">{children}</ul>,
          ol: ({ children }) => <ol className="list-decimal pl-5 space-y-1">{children}</ol>,
          a: ({ href, children }) => (
            <a href={href} target="_blank" rel="noreferrer" className="underline underline-offset-2 hover:text-foreground">
              {children}
            </a>
          ),
          strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
          code: ({ children }) => (
            <code className="rounded bg-muted/40 px-1 py-0.5 font-mono text-[0.9em]">{children}</code>
          ),
          pre: ({ children }) => (
            <pre className="overflow-x-auto rounded-md border border-border/20 bg-card/50 p-3 font-mono text-[0.9em] [&_code]:bg-transparent [&_code]:p-0">
              {children}
            </pre>
          ),
          blockquote: ({ children }) => (
            <blockquote className="border-l-2 border-border/40 pl-3 italic">{children}</blockquote>
          ),
          table: ({ children }) => (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-left">{children}</table>
            </div>
          ),
          th: ({ children }) => (
            <th className="border border-border/30 px-2 py-1 font-semibold text-foreground">{children}</th>
          ),
          td: ({ children }) => <td className="border border-border/30 px-2 py-1 align-top">{children}</td>,
          img: ({ src, alt }) => <img src={typeof src === 'string' ? src : undefined} alt={alt ?? ''} className="max-w-full rounded-md" />,
          hr: () => <hr className="border-border/30" />,
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  )
}
