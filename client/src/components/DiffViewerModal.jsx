import { useEffect, useRef } from 'react'
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

  // Monaco's DiffEditor disposes its two text models during unmount, and if the
  // whole modal is unmounted at the same moment (closing the wizard that owns it
  // takes this with it) the widget still holds a reference: "TextModel got
  // disposed before DiffEditorWidget model got reset". Keeping the models means
  // the widget never disposes them out from under itself; we dispose them a tick
  // later, after the widget is gone.
  const models = useRef(null)
  useEffect(() => {
    const held = models
    return () => {
      const m = held.current
      if (!m) return
      held.current = null
      setTimeout(() => {
        try { m.original?.dispose() } catch { /* already gone */ }
        try { m.modified?.dispose() } catch { /* already gone */ }
      }, 0)
    }
  }, [])

  // Esc closes the diff rather than the thing behind it.
  useEffect(() => {
    const onKey = e => { if (e.key === 'Escape') { e.stopPropagation(); onClose?.() } }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

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
            keepCurrentOriginalModel
            keepCurrentModifiedModel
            options={{
              readOnly:             true,
              fixedOverflowWidgets: true,
              minimap:              { enabled: false },
              fontSize:             12,
              renderSideBySide:     true,
              scrollBeyondLastLine: false,
            }}
            onMount={(editor, monaco) => {
              models.current = {
                original: editor.getOriginalEditor().getModel(),
                modified: editor.getModifiedEditor().getModel(),
              }
              registerTM1Theme(monaco, dark)
            }}
          />
        </div>
      </div>
    </div>
  )
}
