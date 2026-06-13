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
        ? (state.mdx ?? state.MDX ?? '')
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

export default function DiffTab({ tab }) {
  const { dark } = useStore()
  const { before, after, objectType } = tab

  const original = stateToText(before, objectType)
  const modified = stateToText(after, objectType)
  const language = langFor(objectType, before ?? after)

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-4 py-2 border-b border-border bg-muted/20 shrink-0 text-[11px] text-muted-foreground">
        <div className="flex items-center gap-3">
          <span className="text-foreground font-medium">{tab.objectType}</span>
          {tab.server && <span>· {tab.server}</span>}
        </div>
        <div className="flex items-center gap-10">
          <span>← Baseline</span>
          <span>Current →</span>
        </div>
      </div>
      <div className="flex-1 min-h-0">
        <DiffEditor
          original={original}
          modified={modified}
          language={language}
          theme={dark ? 'tm1-dark' : 'tm1-light'}
          options={{
            readOnly:             true,
            fixedOverflowWidgets: true,
            minimap:              { enabled: true },
            fontSize:             13,
            renderSideBySide:     true,
            scrollBeyondLastLine: false,
          }}
          onMount={(_, monaco) => registerTM1Theme(monaco, dark)}
        />
      </div>
    </div>
  )
}
