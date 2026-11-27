import { useEffect } from 'react'
import { X, HelpCircle, ExternalLink } from 'lucide-react'
import { HELP_CONTENT } from '@/lib/help-content'

const ARTICLES = 'https://falconbi.github.io/articles/'
const DEFAULT_DOCS = [
  { label: 'falconbi articles', href: ARTICLES },
  { label: 'TM1 IDE guide', href: ARTICLES + 'tm1-ide-guide.html' },
]

// Minimal markdown-lite: **bold** and `code` spans only — deliberately not a
// full markdown renderer for a handful of short paragraphs per section.
function renderBody(text) {
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g)
  return parts.map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      return <strong key={i} className="text-foreground font-semibold">{part.slice(2, -2)}</strong>
    }
    if (part.startsWith('`') && part.endsWith('`')) {
      return <code key={i} className="font-mono text-[11px] px-1 py-px rounded bg-muted border border-border">{part.slice(1, -1)}</code>
    }
    return part
  })
}

export default function HelpPanel({ open, onClose, area }) {
  useEffect(() => {
    if (!open) return
    const onKey = (e) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  const content = HELP_CONTENT[area]
  if (!content) return null

  const docs = [...(content.docs ?? DEFAULT_DOCS)]
  if (!docs.some(d => d.href === ARTICLES)) docs.push({ label: 'All articles', href: ARTICLES })

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={onClose}>
      <div
        className="bg-popover border border-border rounded-lg shadow-xl w-[640px] max-w-[94vw] max-h-[82vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <HelpCircle size={16} className="text-primary" />
            {content.title}
          </div>
          <button onClick={onClose} className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground">
            <X size={14} />
          </button>
        </div>

        <div className="flex-1 overflow-auto px-4 py-3 space-y-4">
          {content.sections.map((s) => (
            <div key={s.heading}>
              <div className="text-xs font-semibold text-foreground mb-1">{s.heading}</div>
              {s.body && <p className="text-xs text-muted-foreground leading-relaxed">{renderBody(s.body)}</p>}
              {s.table && (
                <div className="mt-2 overflow-x-auto rounded border border-border">
                  <table className="w-full text-[11px] border-collapse">
                    <thead>
                      <tr>
                        {s.table.columns.map((c) => (
                          <th key={c} className="text-left font-semibold text-foreground bg-muted/40 px-2 py-1.5 border-b border-border whitespace-nowrap">{c}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {s.table.rows.map((row, i) => (
                        <tr key={i} className="align-top">
                          {row.map((cell, j) => (
                            <td key={j} className="px-2 py-1.5 text-muted-foreground border-b border-border/40 last:border-0">{renderBody(cell)}</td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          ))}

          <div className="pt-2 border-t border-border">
            <div className="text-xs font-semibold text-foreground mb-1">Documentation</div>
            <div className="flex flex-col gap-1">
              {docs.map(d => (
                <a
                  key={d.href}
                  href={d.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground w-fit"
                >
                  <ExternalLink size={11} className="shrink-0" />
                  {d.label}
                </a>
              ))}
            </div>
          </div>
        </div>

        <div className="px-4 py-2 border-t border-border text-[10px] text-muted-foreground text-center">
          Press <kbd className="font-mono px-1 rounded bg-muted border border-border">Esc</kbd> to close
        </div>
      </div>
    </div>
  )
}
