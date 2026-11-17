import { useEffect, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Play, Loader2, AlertCircle } from 'lucide-react'
import { useStore } from '@/store'
import { usePreviewDatasource, viewPreviewRecordsQuery, subsetElementsQuery, fileContentQuery } from '@/hooks/useApi'
import { subsetTabId } from '@/lib/tab-ids'
import { cn } from '@/lib/utils'
import { parseAsciiPreview, asciiFileReadMessage } from '@/lib/process-editor/ascii-preview'

// Preview of what the process will read, for every datasource type: the ODBC query's rows (with ?pName?
// tokens filled from the parameter defaults, as TM1 does), the first lines of a file, a subset's elements,
// the first records of a cube view (read from the server, never the whole view), or a subset's elements.
export default function DatasourcePreview({ ds, server, params }) {
  const { openTab } = useStore()
  const preview = usePreviewDatasource()
  const queryClient = useQueryClient()
  const [result, setResult]   = useState(null)
  const [error,  setError]    = useState(null)
  const [loading, setLoading] = useState(false)
  const type = ds?.Type ?? 'None'
  const name = ds?.dataSourceNameForServer ?? ''

  useEffect(() => { setResult(null); setError(null) }, [type, name, ds?.view, ds?.subset, ds?.query])

  // TM1 substitutes ?pName? as plain text, no quoting
  const fillParams = q => (q ?? '').replace(/\?(\w+)\?/g, (m, n) => {
    const p = (params ?? []).find(x => x.Name?.toLowerCase() === n.toLowerCase())
    return p ? String(p.Value ?? '') : m
  })

  const fail = e => { setError(e.message ?? String(e)); setLoading(false) }

  const run = async () => {
    setResult(null); setError(null)
    if (type === 'ODBC') {
      preview.mutate({ dsn: name, query: fillParams(ds?.query) }, { onSuccess: setResult, onError: fail })
      return
    }
    setLoading(true)
    try {
      if (type === 'TM1CubeView') {
        const d = await queryClient.fetchQuery({ ...viewPreviewRecordsQuery(server, name, ds?.view ?? ''), staleTime: 0 })
        setResult({ columns: d.columns, rows: d.rows, rowCount: d.rows.length, note: `the first records, as the process receives them · the view has ${d.viewRows.toLocaleString()} rows` })
      } else if (type === 'TM1DimensionSubset') {
        const d = await queryClient.fetchQuery({ ...subsetElementsQuery(server, name, ds?.subset ?? ''), staleTime: 0 })
        const els = (Array.isArray(d) ? d : d.elements ?? []).map(e => e.name ?? e.Name ?? e)
        setResult({ columns: ['Element'], rows: els.slice(0, 200).map(e => [e]), rowCount: els.length })
      } else if (type === 'ASCII') {
        const file = name.split(/[\\/]/).pop()
        try {
          const text = await queryClient.fetchQuery({ ...fileContentQuery(server, file), staleTime: 0 })
          setResult(parseAsciiPreview(text, {
            delimiter: ds?.asciiDelimiterChar || ',',
            headerRecords: ds?.asciiHeaderRecords ?? 1,
          }))
        } catch (e) {
          throw new Error(asciiFileReadMessage(file, e), { cause: e })
        }
      }
      setLoading(false)
    } catch (e) { fail(e) }
  }

  const openSubset = () => openTab({ id: subsetTabId(server, name, name, ds.subset), type: 'subset', label: ds.subset, server, dimension: name, subsetName: ds.subset })

  const busy = loading || preview.isPending
  const btn  = 'flex items-center gap-1.5 px-2.5 py-1 text-xs rounded border border-border text-muted-foreground hover:text-foreground hover:bg-muted transition-colors disabled:opacity-40'
  const canPreview = type === 'TM1CubeView' ? !!(name && ds?.view) : type === 'ODBC' ? !!(name && ds?.query) : type === 'ASCII' ? !!name : type === 'TM1DimensionSubset' ? !!(name && ds?.subset) : false

  return (
    <div className="px-3 py-2 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <div className="text-[10px] text-muted-foreground truncate">
          {type === 'TM1CubeView'
            ? <>The process reads every record of <span className="font-mono text-foreground">{ds?.view || '—'}</span> on <span className="font-mono text-foreground">{name || '—'}</span></>
            : type === 'ODBC' ? <>DSN: <span className="font-mono text-foreground">{name || '—'}</span>{/\?\w+\?/.test(ds?.query ?? '') && ' · parameters filled from their defaults'}</>
            : type === 'ASCII' ? <>File: <span className="font-mono text-foreground">{name || '—'}</span></>
            : <>Subset: <span className="font-mono text-foreground">{ds?.subset || '—'}</span> of <span className="font-mono text-foreground">{name || '—'}</span></>}
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {type === 'TM1DimensionSubset' && (
            <button onClick={openSubset} disabled={!name || !ds?.subset} className={btn} title="Open the source subset in its own tab">Open subset</button>
          )}
          <button
            onClick={run}
            disabled={busy || !canPreview}
            className="flex items-center gap-1.5 px-2.5 py-1 text-xs rounded bg-emerald-700 text-white disabled:opacity-40 hover:bg-emerald-600 transition-colors"
          >
            {busy ? <Loader2 size={10} className="animate-spin" /> : <Play size={10} />}
            Preview
          </button>
        </div>
      </div>

      {error && (
        <div className="flex items-start gap-2 text-red-400 text-xs">
          <AlertCircle size={12} className="shrink-0 mt-0.5" />
          <span className="font-mono whitespace-pre-wrap">{error}</span>
        </div>
      )}

      {result && (
        <div className="border border-border rounded overflow-hidden">
          <div className="flex items-center justify-between px-2 py-1 bg-muted border-b border-border">
            <span className="text-[10px] text-muted-foreground">
              {result.rowCount} {type === 'TM1CubeView' ? 'record' : 'row'}{result.rowCount !== 1 ? 's' : ''}{result.note ? ` — showing ${result.note}` : ''}{result.duration != null ? ` — ${result.duration}ms` : ''}
            </span>
          </div>
          <div className="overflow-x-auto max-h-48">
            <table className="w-full text-xs border-collapse">
              <thead className="sticky top-0 bg-muted">
                <tr>
                  {result.columns.map((c, i) => (
                    <th key={i} className="text-left px-2 py-1 font-medium text-muted-foreground border-b border-border whitespace-nowrap">{c}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {result.rows.map((row, i) => (
                  <tr key={i} className={cn('border-b border-border/50', i % 2 === 0 ? 'bg-background' : 'bg-muted/20')}>
                    {row.map((cell, j) => (
                      <td key={j} className="px-2 py-0.5 font-mono whitespace-nowrap max-w-xs truncate text-foreground/80">
                        {cell === null ? <span className="text-muted-foreground italic">NULL</span> : String(cell)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
