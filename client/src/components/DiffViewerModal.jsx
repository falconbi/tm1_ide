import { X } from 'lucide-react'
import { DiffEditor } from '@monaco-editor/react'
import { useStore } from '@/store'
import { registerTM1Theme } from '@/lib/tm1-functions'

function stateToText(state, objectType) {
  if (!state) return ''
  switch (objectType) {
    case 'rules':
      return state.text ?? ''
    case 'process':
      return [
        `#-- Prolog --\n${state.prolog ?? ''}`,
        `#-- Metadata --\n${state.metadata ?? ''}`,
        `#-- Data --\n${state.data ?? ''}`,
        `#-- Epilog --\n${state.epilog ?? ''}`,
      ].join('\n\n')
    case 'subset':
      return state.expression ?? (state.elements ?? []).join('\n')
    case 'view':
      return state.type === 'mdx'
        ? (state.mdx ?? '')
        : JSON.stringify(state.definition ?? state, null, 2)
    default:
      return JSON.stringify(state, null, 2)
  }
}

function langFor(objectType, state) {
  if (objectType === 'rules')   return 'tm1rules'
  if (objectType === 'process') return 'tm1ti'
  if (objectType === 'subset')  return 'mdx'
  if (objectType === 'view')    return state?.type === 'native' ? 'json' : 'mdx'
  return 'plaintext'
}

function fmtDateTime(ts) {
  if (!ts) return ''
  try { return new Date(ts).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) } catch { return ts }
}

export default function DiffViewerModal({ entry, onClose }) {
  const { dark } = useStore()

  const original = stateToText(entry.before_state, entry.object_type)
  const modified = stateToText(entry.after_state,  entry.object_type)
  const language = langFor(entry.object_type, entry.before_state ?? entry.after_state)

  return (
    <div className="fixed inset-0 bg-black/60 z-[200] flex items-center justify-center" onClick={onClose}>
      <div
        className="w-[960px] h-[620px] bg-background border border-border rounded-lg shadow-2xl flex flex-col overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-2.5 border-b border-border bg-muted/30 shrink-0">
          <div>
            <div className="text-sm font-semibold">{entry.object_name}</div>
            <div className="text-[10px] text-muted-foreground">
              {fmtDateTime(entry.timestamp)} · {entry.action.replace(/_/g, ' ')}
              {entry.session_name && ` · ${entry.session_name}`}
            </div>
          </div>
          <div className="flex items-center gap-6 text-[10px] text-muted-foreground mr-4">
            <span>← Before</span>
            <span>After →</span>
          </div>
          <button onClick={onClose} className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors">
            <X size={14} />
          </button>
        </div>

        {/* Diff editor */}
        <div className="flex-1 min-h-0">
          <DiffEditor
            original={original}
            modified={modified}
            language={language}
            theme={dark ? 'tm1-dark' : 'tm1-light'}
            options={{
              readOnly:             true,
              fixedOverflowWidgets: true,
              minimap:              { enabled: false },
              fontSize:             12,
              renderSideBySide:     true,
              scrollBeyondLastLine: false,
            }}
            onMount={(_, monaco) => registerTM1Theme(monaco, dark)}
          />
        </div>
      </div>
    </div>
  )
}
