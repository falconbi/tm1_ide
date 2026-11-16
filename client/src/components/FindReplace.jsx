import { useState } from 'react'
import { useStore } from '@/store'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Search, Replace, ChevronDown, ChevronRight, X, AlertTriangle } from 'lucide-react'
import { ScrollArea } from '@/components/ui/scroll-area'
import { cn } from '@/lib/utils'
import { rulesTabId, processTabId } from '@/lib/tab-ids'

const enc = encodeURIComponent

const SECTIONS = ['Prolog', 'Metadata', 'Data', 'Epilog']

function escapeRegex(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') }

function searchIndex(index, term, useRegex, scope) {
  if (!term || !index) return []
  if (!Array.isArray(index.rules) || !Array.isArray(index.processes)) return []
  let re
  try {
    re = new RegExp(useRegex ? term : escapeRegex(term), 'gi')
  } catch { return [] }

  const results = []

  if (scope !== 'processes') {
    for (const { name, rules } of index.rules) {
      if (!rules) continue
      const lines = rules.split('\n')
      lines.forEach((line, i) => {
        const matches = [...line.matchAll(re)]
        if (matches.length) {
          results.push({ type: 'rules', object: name, section: 'Rules', line: i + 1, text: line.trim(), matches: matches.length })
        }
      })
    }
  }

  if (scope !== 'rules') {
    for (const proc of index.processes) {
      for (const section of SECTIONS) {
        const code = proc[section]
        if (!code) continue
        const lines = code.split('\n')
        lines.forEach((line, i) => {
          const matches = [...line.matchAll(re)]
          if (matches.length) {
            results.push({ type: 'process', object: proc.name, section, line: i + 1, text: line.trim(), matches: matches.length })
          }
        })
      }
    }
  }

  return results
}

function applyReplace(index, term, replacement, useRegex, scope) {
  if (!index || !Array.isArray(index.rules) || !Array.isArray(index.processes)) return null
  let re
  try {
    re = new RegExp(useRegex ? term : escapeRegex(term), 'g')
  } catch { return null }

  const rulesChanges = []
  const processChanges = []

  if (scope !== 'processes') {
    for (const { name, rules } of index.rules) {
      if (!rules || !re.test(rules)) { re.lastIndex = 0; continue }
      re.lastIndex = 0
      rulesChanges.push({ name, newRules: rules.replace(re, replacement) })
    }
  }

  if (scope !== 'rules') {
    for (const proc of index.processes) {
      const updated = {}
      let changed = false
      for (const section of SECTIONS) {
        const code = proc[section] ?? ''
        re.lastIndex = 0
        if (re.test(code)) {
          re.lastIndex = 0
          updated[section] = code.replace(re, replacement)
          changed = true
        } else {
          updated[section] = code
        }
      }
      if (changed) processChanges.push({ name: proc.name, updated })
    }
  }

  return { rulesChanges, processChanges }
}

function ResultGroup({ object, type, results, onOpen }) {
  const [open, setOpen] = useState(true)
  return (
    <div className="border-b border-border">
      <button
        onClick={() => setOpen(o => !o)}
        className="flex items-center gap-2 w-full px-3 py-1.5 hover:bg-muted text-sm font-medium"
      >
        {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        <span className="truncate">{object}</span>
        <span className="ml-auto text-xs text-muted-foreground shrink-0">
          {type === 'rules' ? 'Rules' : 'Process'} · {results.length} match{results.length !== 1 ? 'es' : ''}
        </span>
      </button>
      {open && results.map((r, i) => (
        <button
          key={i}
          onClick={() => onOpen(r)}
          className="flex items-center gap-3 w-full px-6 py-1 hover:bg-muted text-xs text-left group"
        >
          <span className="text-muted-foreground shrink-0 w-8 text-right">{r.line}</span>
          <span className="text-muted-foreground shrink-0">{r.section}</span>
          <span className="font-mono truncate text-foreground">{r.text}</span>
        </button>
      ))}
    </div>
  )
}

export default function FindReplace({ onClose }) {
  const { server, openTab } = useStore()
  const queryClient = useQueryClient()

  const [term, setTerm] = useState('')
  const [replacement, setReplacement] = useState('')
  const [useRegex, setUseRegex] = useState(false)
  const [scope, setScope] = useState('all')
  const [showReplace, setShowReplace] = useState(false)
  const [preview, setPreview] = useState(null)
  const [searched, setSearched] = useState(false)

  const { data: index, isFetching, refetch, error: searchError } = useQuery({
    queryKey: ['search-index', server],
    queryFn: async () => {
      const r = await fetch(`/api/search/index?server=${enc(server)}`, { headers: { 'x-ide-token': localStorage.getItem('tm1-token') ?? '' } })
      let d = {}
      try { d = await r.json() } catch { /* non-JSON error page */ }
      if (!r.ok || d.error) throw new Error(d.error || `${r.status} ${r.statusText}`)
      if (!Array.isArray(d.rules) || !Array.isArray(d.processes)) throw new Error('Unexpected search index response')
      return d
    },
    enabled: false,
    staleTime: 60_000,
  })

  const results = searched && index && term
    ? searchIndex(index, term, useRegex, scope)
    : []

  const grouped = results.reduce((acc, r) => {
    const key = r.object + ':' + r.type
    if (!acc[key]) acc[key] = { object: r.object, type: r.type, results: [] }
    acc[key].results.push(r)
    return acc
  }, {})

  const handleSearch = async () => {
    await refetch()
    setSearched(true)
    setPreview(null)
  }

  const handlePreview = () => {
    if (!index || !term) return
    const changes = applyReplace(index, term, replacement, useRegex, scope)
    setPreview(changes)
  }

  const handleReplace = async () => {
    if (!preview) return
    const { rulesChanges, processChanges } = preview

    // Never write over an editor buffer that would later save its old text back.
    const ruleNames  = new Set(rulesChanges.map(x => x.name))
    const procNames  = new Set(processChanges.map(x => x.name))
    const dirty = useStore.getState().tabs.filter(t => t.dirty && (
      (t.type === 'rules' && ruleNames.has(t.cube)) ||
      (t.type === 'process' && procNames.has(t.name))
    ))
    if (dirty.length) {
      toast.error(`Not replacing — unsaved editor tab${dirty.length > 1 ? 's' : ''}: ${dirty.map(t => t.label || t.name || t.cube).join(', ')}`)
      return
    }

    const save = async (url, body) => {
      const r = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-ide-token': localStorage.getItem('tm1-token') ?? '' },
        body: JSON.stringify(body),
      })
      let d = {}
      try { d = await r.json() } catch { /* non-JSON error page */ }
      if (!r.ok || d.error) throw new Error(d.error || `${r.status} ${r.statusText}`)
      return d
    }

    const jobs = [
      ...rulesChanges.map(({ name, newRules }) => ({
        type: 'rules', name,
        run: () => save(`/api/rules?server=${enc(server)}&cube=${enc(name)}`, { rules: newRules }),
      })),
      ...processChanges.map(({ name, updated }) => ({
        type: 'process', name,
        run: () => save(`/api/process?server=${enc(server)}&name=${enc(name)}`, {
          PrologProcedure:   updated.Prolog,
          MetadataProcedure: updated.Metadata,
          DataProcedure:     updated.Data,
          EpilogProcedure:   updated.Epilog,
        }),
      })),
    ]

    const id = toast.loading(`Replacing in ${jobs.length} objects…`)
    const settled = await Promise.allSettled(jobs.map(j => j.run()))
    const failed = settled
      .map((result, i) => ({ result, job: jobs[i] }))
      .filter(x => x.result.status === 'rejected')
    const succeeded = settled
      .map((result, i) => ({ result, job: jobs[i] }))
      .filter(x => x.result.status === 'fulfilled')
      .map(x => x.job)

    for (const job of succeeded) {
      if (job.type === 'rules') {
        useStore.getState().bumpRulesVersion(server, job.name)
        queryClient.invalidateQueries({ queryKey: ['rules', server, job.name] })
      } else {
        queryClient.invalidateQueries({ queryKey: ['process', server, job.name] })
      }
    }
    if (succeeded.length) queryClient.invalidateQueries({ queryKey: ['search-index', server] })

    if (!failed.length) {
      setPreview(null)
      setSearched(false)
      toast.success(`Replaced in ${jobs.length} objects`, { id })
      return
    }

    const failedRules = new Set(failed.filter(x => x.job.type === 'rules').map(x => x.job.name))
    const failedProcs = new Set(failed.filter(x => x.job.type === 'process').map(x => x.job.name))
    setPreview({
      rulesChanges:   rulesChanges.filter(x => failedRules.has(x.name)),
      processChanges: processChanges.filter(x => failedProcs.has(x.name)),
    })
    const names = failed.map(x => `${x.job.type} ${x.job.name}`).join(', ')
    toast.error(`Replaced in ${succeeded.length}, failed in ${failed.length}: ${names}`, { id })
  }

  const handleOpen = (result) => {
    if (result.type === 'rules') {
      openTab({ id: rulesTabId(server, result.object), type: 'rules', label: result.object, server, cube: result.object, content: null, scrollToLine: result.line })
    } else {
      openTab({ id: processTabId(server, result.object), type: 'process', label: result.object, server, name: result.object, content: null, scrollToLine: result.line, scrollToSection: result.section })
    }
  }

  const totalMatches = results.reduce((s, r) => s + r.matches, 0)

  return (
    <div className="flex flex-col h-full overflow-hidden border-r border-border bg-sidebar">

      {/* ── Header ─────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-border shrink-0">
        <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Find & Replace</span>
        <button onClick={onClose} className="text-muted-foreground hover:text-foreground"><X size={14} /></button>
      </div>

      {/* ── Controls ───────────────────────────────────────────────────── */}
      <div className="px-3 py-2 space-y-2 shrink-0 border-b border-border">

        {/* Find */}
        <div className="flex gap-1">
          <input
            value={term}
            onChange={e => { setTerm(e.target.value); setSearched(false) }}
            onKeyDown={e => e.key === 'Enter' && handleSearch()}
            placeholder={useRegex ? "e.g. DB\\('.*Sales.*'" : 'Search…'}
            className="flex-1 bg-background border border-border rounded px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-ring font-mono"
          />
          <button
            onClick={() => setUseRegex(r => !r)}
            className={cn('px-2 py-1 rounded border text-xs font-mono', useRegex ? 'bg-primary text-primary-foreground border-primary' : 'border-border text-muted-foreground hover:text-foreground')}
            title="Toggle regex mode"
          >.*</button>
        </div>

        {/* Regex cheatsheet */}
        {useRegex && (
          <div className="rounded border border-border bg-muted/50 p-2 space-y-1">
            <p className="text-xs font-medium text-muted-foreground mb-1.5">Common patterns</p>
            {[
              { pattern: "DB\\('OldCube'",     hint: 'DB() calls into a cube' },
              { pattern: "DB\\('.*Sales.*'",    hint: 'DB() into any Sales cube' },
              { pattern: 'CellPutN\\(',         hint: 'All cell write operations' },
              { pattern: 'ExecuteProcess\\(',   hint: 'Process calls' },
              { pattern: '2024',                hint: 'Hardcoded year' },
              { pattern: "^\\s*#",              hint: 'Commented-out lines' },
              { pattern: "pYear\\b",            hint: 'Exact parameter name' },
            ].map(({ pattern, hint }) => (
              <button
                key={pattern}
                onClick={() => { setTerm(pattern); setSearched(false) }}
                className="flex items-center gap-2 w-full text-left hover:bg-muted rounded px-1 py-0.5 group"
              >
                <code className="text-xs text-primary shrink-0">{pattern}</code>
                <span className="text-xs text-muted-foreground truncate">{hint}</span>
              </button>
            ))}
          </div>
        )}

        {/* Replace toggle + input */}
        <button onClick={() => setShowReplace(r => !r)} className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
          {showReplace ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
          Replace
        </button>
        {showReplace && (
          <input
            value={replacement}
            onChange={e => setReplacement(e.target.value)}
            placeholder="Replace with…"
            className="w-full bg-background border border-border rounded px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
          />
        )}

        {/* Scope */}
        <div className="flex gap-1">
          {['all', 'rules', 'processes'].map(s => (
            <button
              key={s}
              onClick={() => setScope(s)}
              className={cn('px-2 py-0.5 rounded text-xs capitalize', scope === s ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:text-foreground')}
            >{s}</button>
          ))}
        </div>

        {/* Actions */}
        <div className="flex gap-2">
          <button
            onClick={handleSearch}
            disabled={!term || !server || isFetching}
            className="flex items-center gap-1.5 px-3 py-1 rounded bg-primary text-primary-foreground text-xs disabled:opacity-40 hover:opacity-90"
          >
            <Search size={11} />
            {isFetching ? 'Loading…' : 'Search'}
          </button>
          {showReplace && searched && results.length > 0 && (
            <>
              <button
                onClick={handlePreview}
                className="flex items-center gap-1.5 px-3 py-1 rounded border border-border text-xs hover:bg-muted"
              >
                Preview
              </button>
              {preview && (
                <button
                  onClick={handleReplace}
                  className="flex items-center gap-1.5 px-3 py-1 rounded bg-destructive text-white text-xs hover:opacity-90"
                >
                  <Replace size={11} />
                  Replace all
                </button>
              )}
            </>
          )}
        </div>

        {/* Summary */}
        {searched && (
          searchError
            ? <p className="text-xs text-red-400">Search failed: {searchError.message}</p>
            : <p className="text-xs text-muted-foreground">
                {results.length === 0 ? 'No matches' : `${totalMatches} match${totalMatches !== 1 ? 'es' : ''} in ${Object.keys(grouped).length} object${Object.keys(grouped).length !== 1 ? 's' : ''}`}
              </p>
        )}

        {/* Preview summary */}
        {preview && (
          <div className="flex items-start gap-2 p-2 rounded bg-orange-50 dark:bg-orange-950 border border-orange-200 dark:border-orange-800 text-xs text-orange-800 dark:text-orange-200">
            <AlertTriangle size={12} className="shrink-0 mt-0.5" />
            <span>Will replace in {preview.rulesChanges.length} cube{preview.rulesChanges.length !== 1 ? 's' : ''} and {preview.processChanges.length} process{preview.processChanges.length !== 1 ? 'es' : ''}. This writes directly to the server.</span>
          </div>
        )}
      </div>

      {/* ── Results ────────────────────────────────────────────────────── */}
      <ScrollArea className="flex-1 min-h-0">
        {Object.values(grouped).map(g => (
          <ResultGroup key={g.object + g.type} {...g} onOpen={handleOpen} />
        ))}
      </ScrollArea>
    </div>
  )
}
