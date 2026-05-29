import { useState } from 'react'
import MonacoEditor from '@monaco-editor/react'
import { useStore } from '@/store'
import { Play, Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import GuidedMDXBuilder from './GuidedMDXBuilder'
import ResultGrid from './mdx/ResultGrid'

/**
 * MDXSandbox — supports both the Guided Builder (default / recommended for new users)
 * and a Raw editor mode with full Monaco + AG Grid results.
 *
 * Real handoff: clicking "Open in Raw Editor" from Guided seeds the raw MDX and switches mode.
 */
export default function MDXSandbox({ tab }) {
  const { dark } = useStore()
  const [mode, setMode] = useState('guided') // 'guided' | 'raw'
  const [rawMdx, setRawMdx] = useState('')
  const [rawResult, setRawResult] = useState(null)
  const [rawError, setRawError] = useState(null)
  const [rawRunning, setRawRunning] = useState(false)

  const executeRaw = async (query) => {
    const q = (query || rawMdx).trim()
    if (!q) return

    setRawRunning(true)
    setRawError(null)
    setRawResult(null)
    try {
      const res = await fetch(`/api/mdx/execute?server=${encodeURIComponent(tab.server)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mdx: q }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Execution failed')
      setRawResult(data)
    } catch (e) {
      let msg = e.message
      try { msg = JSON.parse(e.message).message || msg } catch {}
      setRawError(msg)
    } finally {
      setRawRunning(false)
    }
  }

  // Real handoff from Guided — seeds the editor and switches to Raw mode
  const switchToRaw = (initialMdx) => {
    if (initialMdx) setRawMdx(initialMdx)
    setMode('raw')
  }

  return (
    <div className="flex h-full min-h-0">
      <div className="flex flex-col flex-1 min-w-0 min-h-0">
        {/* Mode toolbar */}
        <div className="flex items-center gap-2 px-3 py-1.5 border-b border-border bg-muted/40 shrink-0">
          <div className="flex items-center border border-border rounded text-xs">
            <button
              onClick={() => setMode('guided')}
              className={cn('px-3 py-1 rounded-l', mode === 'guided' && 'bg-primary text-primary-foreground')}
            >
              Guided
            </button>
            <button
              onClick={() => setMode('raw')}
              className={cn('px-3 py-1 border-l border-border rounded-r', mode === 'raw' && 'bg-primary text-primary-foreground')}
            >
              Raw Editor
            </button>
          </div>

          {mode === 'raw' && (
            <>
              <button
                onClick={() => executeRaw()}
                disabled={rawRunning || !rawMdx.trim()}
                className="flex items-center gap-1.5 px-3 py-1 text-xs rounded bg-primary text-primary-foreground disabled:opacity-50"
              >
                {rawRunning ? <Loader2 size={11} className="animate-spin" /> : <Play size={11} />}
                Execute
              </button>
              <span className="text-[10px] text-muted-foreground">Ctrl+Enter</span>
            </>
          )}
        </div>

        {mode === 'guided' ? (
          <div className="flex-1 min-h-0">
            <GuidedMDXBuilder server={tab.server} onSwitchToRaw={switchToRaw} />
          </div>
        ) : (
          <div className="flex flex-col flex-1 min-h-0">
            <div className="flex-1 min-h-0">
              <MonacoEditor
                height="100%"
                language="mdx"
                value={rawMdx}
                theme={dark ? 'vs-dark' : 'vs'}
                onChange={v => setRawMdx(v ?? '')}
                options={{ fontSize: 13, minimap: { enabled: false }, wordWrap: 'on', suggestOnTriggerCharacters: true }}
                onMount={(editor, monaco) => {
                  editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, () => executeRaw())
                }}
              />
            </div>

            {rawError && (
              <div className="shrink-0 max-h-40 overflow-auto border-t border-red-800 bg-red-950/30 px-4 py-2 text-xs text-red-300 font-mono">
                {rawError}
              </div>
            )}

            <div className="flex-1 min-h-0 border-t border-border">
              {rawResult ? (
                <ResultGrid axes={rawResult.Axes} cells={rawResult.Cells} truncated={rawResult.truncated} />
              ) : (
                <div className="h-full flex items-center justify-center text-[10px] text-muted-foreground">
                  Run a query (Ctrl+Enter) to see results here
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}