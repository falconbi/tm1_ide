import { useCallback, useEffect, useState } from 'react'
import { ChevronDown, ChevronRight, Database, Loader2, RefreshCw, Workflow, ArrowDownToLine, ArrowUpFromLine, Copy, Sparkles } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip'

const TIP = 'block w-[430px] max-w-[calc(100vw-2rem)] whitespace-normal bg-popover text-foreground border border-border rounded-md p-3 text-[11px] leading-relaxed shadow-xl'
import ProcessSummariesDialog from '@/components/ProcessSummariesDialog'

// A read-only summary of everything that feeds a cube: TI writers (with the measures they
// write), the cube's rule dependencies, TI readers, and processes that copy it (snapshots).
// Same scan as the Cube Map — see core/cube_data_sources.js.
export default function CubeDataSources({ server, cube, onOpenCube, onOpenProcess, onOpenMap }) {
  const [open, setOpen] = useState(false)
  const [showSummaries, setShowSummaries] = useState(false)
  const [loading, setLoading] = useState(true)
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)

  const load = useCallback(async (refresh = false) => {
    setLoading(true); setError(null)
    try {
      const token = localStorage.getItem('tm1-token') ?? ''
      const r = await fetch(`/api/cube/data-sources?server=${encodeURIComponent(server)}&cube=${encodeURIComponent(cube)}${refresh ? '&refresh=1' : ''}`, {
        headers: { 'x-ide-token': token },
      })
      const d = await r.json()
      if (!r.ok || d.error) throw new Error(d.error || r.statusText)
      setData(d)
    } catch (e) { setError(e.message) }
    finally { setLoading(false) }
  }, [server, cube])

  useEffect(() => { load() }, [load])

  const writers  = data?.writers ?? []
  const ruleCalc = data?.ruleReads?.calc ?? []
  const ruleFeed = data?.ruleReads?.feeders ?? []
  const readers  = data?.readers ?? []
  const copiers  = data?.copiers ?? []
  const ruleCount = new Set([...ruleCalc, ...ruleFeed]).size

  return (
    <>
    <div className="shrink-0 border-b border-border bg-muted/20 text-xs">
      <div className="flex items-center gap-2 px-3 py-1 min-h-[26px]">
        <button onClick={() => setOpen(o => !o)} className="flex items-center gap-2 min-w-0 text-left hover:text-foreground">
          {open ? <ChevronDown size={11} className="shrink-0" /> : <ChevronRight size={11} className="shrink-0" />}
          <Database size={11} className="shrink-0 text-sky-400/80" />
          <span className="font-medium shrink-0">Data sources</span>
          {loading ? (
            <span className="flex items-center gap-1 text-muted-foreground"><Loader2 size={10} className="animate-spin" /> scanning…</span>
          ) : error ? (
            <span className="text-red-400 truncate" title={error}>unavailable</span>
          ) : (
            <span className="text-muted-foreground truncate">
              {writers.length
                ? <>{writers.length} TI writer{writers.length !== 1 ? 's' : ''}</>
                : <>no TI writers — typed or rule-calculated</>}
              {' · '}{ruleCount} rule source{ruleCount !== 1 ? 's' : ''}
              {' · '}{readers.length} TI reader{readers.length !== 1 ? 's' : ''}
              {copiers.length > 0 && <>{' · '}copied by {copiers.length}</>}
            </span>
          )}
        </button>
        <div className="ml-auto flex items-center gap-1 shrink-0">
          <button onClick={() => load(true)} title="Rescan" className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors">
            <RefreshCw size={10} className={cn(loading && 'animate-spin')} />
          </button>
          <button onClick={() => setShowSummaries(true)} title="Write or review the plain-English summaries shown on hover"
            className="flex items-center gap-1 px-1.5 py-0.5 rounded border border-border text-[10px] text-muted-foreground hover:text-foreground hover:bg-muted transition-colors">
            <Sparkles size={10} className={data?.aiConfigured ? 'text-sky-400' : ''} /> Summaries
          </button>
          <button onClick={onOpenMap} title="Open the Cube Map focused on this cube"
            className="flex items-center gap-1 px-1.5 py-0.5 rounded border border-border text-[10px] text-muted-foreground hover:text-foreground hover:bg-muted transition-colors">
            <Workflow size={10} /> Cube Map
          </button>
        </div>
      </div>

      {open && !loading && !error && (
        <div className="max-h-96 overflow-auto border-t border-border/60 px-3 py-2 grid items-start gap-x-6 gap-y-2 md:grid-cols-2">
          <Section icon={ArrowDownToLine} title="Written by" tone="text-emerald-400/80">
            {writers.length === 0
              ? <p className="text-muted-foreground italic">No TI writes this cube — values are typed or rule-calculated.</p>
              : writers.map(w => (
                <div key={w.process + w.callers.join()} className="flex items-start gap-1.5 py-0.5">
                  <WriterName w={w} onOpen={onOpenProcess} />
                  <div className="flex flex-wrap gap-1 min-w-0">
                    {w.kinds.includes('clear') && <Badge>clears</Badge>}
                    {w.kinds.includes('feeders') && <Badge>feeders</Badge>}
                    {w.measures.length
                      ? w.measures.map(m => <Badge key={m}>{m}</Badge>)
                      : w.kinds.includes('write') ? <Badge muted>measures from view</Badge> : null}
                  </div>
                </div>
              ))}
          </Section>

          <Section icon={ArrowUpFromLine} title="Read by rules" tone="text-violet-400/80">
            {ruleCalc.length + ruleFeed.length === 0 ? <p className="text-muted-foreground italic">No DB() references.</p> : <>
              {ruleCalc.length > 0 && (
                <div className="flex flex-wrap gap-1 py-0.5">
                  <span className="text-[10px] text-muted-foreground mr-1">calc</span>
                  {ruleCalc.map(c => <CubeChip key={c} cube={c} self={c === cube} evidence={data?.ruleReads?.calcEvidence?.[c]} onOpen={onOpenCube} />)}
                </div>
              )}
              {ruleFeed.length > 0 && (
                <div className="flex flex-wrap gap-1 py-0.5">
                  <span className="text-[10px] text-muted-foreground mr-1"> feeders</span>
                  {ruleFeed.map(c => <CubeChip key={c} cube={c} self={c === cube} evidence={data?.ruleReads?.feederEvidence?.[c]} onOpen={onOpenCube} />)}
                </div>
              )}
            </>}
          </Section>

          <Section icon={ArrowUpFromLine} title="Read by TIs" tone="text-sky-400/80">
            {readers.length === 0 ? <p className="text-muted-foreground italic">No TI reads this cube directly.</p>
              : <div className="flex flex-wrap gap-1 py-0.5">
                  {readers.map(r => <ReaderChip key={r.process} r={r} onOpen={onOpenProcess} />)}
                </div>}
          </Section>

          <Section icon={Copy} title="Copied by" tone="text-amber-400/80">
            {copiers.length === 0 ? <p className="text-muted-foreground italic">No version-copy wrapper targets this cube.</p>
              : <div className="flex flex-wrap gap-1 py-0.5">
                  {copiers.map(c => (
                    <button key={c} onClick={ev => onOpenProcess(c, ev.altKey)} title={`Open ${c} — Alt-click to open here`}
                      className="px-1.5 py-0.5 rounded border border-border font-mono text-[10px] text-muted-foreground hover:text-foreground hover:bg-muted">
                      {c}
                    </button>
                  ))}
                  <span className="text-[10px] text-muted-foreground self-center">stored values are copied into the target version</span>
                </div>}
          </Section>
        </div>
      )}
    </div>
    <ProcessSummariesDialog
      open={showSummaries}
      onClose={() => setShowSummaries(false)}
      server={server}
      cube={cube}
      writers={writers}
      aiConfigured={!!data?.aiConfigured}
      onChanged={() => load()}
    />
    </>
  )
}

function WriterName({ w, onOpen }) {
  const label = (
    <>
      {w.callers.length ? <span className="text-muted-foreground">{w.callers.join(', ')} → </span> : null}{w.process}
    </>
  )
  return (
    <Tooltip>
      <TooltipTrigger delay={150} render={
        <button onClick={ev => onOpen(w.process, ev.altKey)} title={`Open ${w.process} — Alt-click to open here`}
          className="text-left font-mono text-[11px] text-foreground/90 hover:text-primary truncate shrink-0 max-w-[45%]">
          {label}
        </button>
      } />
      <TooltipContent side="top" align="start" sideOffset={6} className={TIP}>
        <div className="flex items-center gap-1.5">
          <span className="font-mono text-xs text-foreground">{w.process}</span>
          {w.summaryStale && <span className="text-[9px] text-amber-500" title="The process changed since this summary was written">summary stale</span>}
        </div>
        {w.source && w.source !== 'None' && (
          <div className="text-[10px] text-muted-foreground mt-0.5">
            Source: {w.source === 'TM1CubeView' ? 'cube view' : w.source}
          </div>
        )}
        {w.summary ? (
          <div className="mt-1.5 rounded border border-sky-500/25 bg-sky-500/5 px-2 py-1.5">
            <div className="text-[9px] uppercase tracking-wider text-sky-400/80 mb-0.5">
              {w.summarySource === 'manual' ? 'Summary' : 'AI summary'}{w.summaryAt ? ' · ' + w.summaryAt.slice(0, 10) : ''}
            </div>
            <p className="text-foreground/90 whitespace-pre-line">{w.summary}</p>
          </div>
        ) : null}
        {(w.reads?.length > 0 || w.parameters?.length > 0) && (
          <div className="mt-1.5 space-y-0.5 text-[10px] text-muted-foreground">
            {w.reads?.length > 0 && <div><span className="text-muted-foreground/60">Reads:</span> {w.reads.join(', ')}</div>}
            {w.parameters?.length > 0 && <div><span className="text-muted-foreground/60">Parameters:</span> {w.parameters.join(', ')}</div>}
          </div>
        )}
        {w.header && (
          <div className="mt-1.5">
            {w.summary && <div className="text-[9px] uppercase tracking-wider text-muted-foreground/60 mb-0.5">TI header</div>}
            <p className="text-muted-foreground whitespace-pre-line line-clamp-[8]">{w.header}</p>
          </div>
        )}
        {w.evidence?.length > 0 && (
          <div className="mt-2">
            <div className="text-[9px] uppercase tracking-wider text-muted-foreground/70 mb-1">Writes this cube</div>
            <div className="space-y-1">
              {w.evidence.slice(0, 5).map((e, i) => (
                <pre key={i} className="font-mono text-[10px] bg-muted/50 rounded px-1.5 py-1 whitespace-pre-wrap break-words text-foreground/80">
                  {e.by ? e.by + ' → ' : ''}{e.code}
                </pre>
              ))}
              {w.evidence.length > 5 && <div className="text-[10px] text-muted-foreground/70">+{w.evidence.length - 5} more…</div>}
            </div>
          </div>
        )}
        <div className="mt-2 text-[10px] text-muted-foreground/70">Click to open the process</div>
      </TooltipContent>
    </Tooltip>
  )
}

function Section({ icon: Icon, title, tone, children }) {
  return (
    <div className="min-w-0">
      <div className={cn('flex items-center gap-1 text-[10px] uppercase tracking-wider font-semibold mb-1', tone)}>
        <Icon size={10} /> {title}
      </div>
      {children}
    </div>
  )
}

function Badge({ children, muted }) {
  return (
    <span className={cn('px-1 py-px rounded text-[10px] font-mono border',
      muted ? 'border-border/70 text-muted-foreground/70' : 'border-border bg-background text-foreground/80')}>
      {children}
    </span>
  )
}

function CubeChip({ cube, self, evidence, onOpen }) {
  const btn = (
    <button onClick={ev => onOpen(cube, ev.altKey)} title={self ? 'Reads its own earlier periods — Alt-click to open here' : `Open ${cube} — Alt-click to open here`}
      className={cn('px-1.5 py-0.5 rounded border font-mono text-[10px] hover:bg-muted transition-colors',
        self ? 'border-dashed border-border text-muted-foreground' : 'border-border text-foreground/80 hover:text-foreground')}>
      {cube}{self ? ' (self)' : ''}
    </button>
  )
  if (!evidence?.length) return btn
  return (
    <Tooltip>
      <TooltipTrigger delay={150} render={btn} />
      <TooltipContent side="top" align="start" sideOffset={6} className={TIP}>
        <div className="font-mono text-xs">{cube}</div>
        <div className="text-[9px] uppercase tracking-wider text-muted-foreground/70 mt-1 mb-1">This cube's rules read it as</div>
        <div className="space-y-1">
          {evidence.slice(0, 3).map((code, i) => (
            <pre key={i} className="font-mono text-[10px] bg-muted/50 rounded px-1.5 py-1 whitespace-pre-wrap break-words text-foreground/80">{code}</pre>
          ))}
          {evidence.length > 3 && <div className="text-[10px] text-muted-foreground/70">+{evidence.length - 3} more…</div>}
        </div>
        <div className="mt-1.5 text-[10px] text-muted-foreground/70">Click to open the rules</div>
      </TooltipContent>
    </Tooltip>
  )
}

function ReaderChip({ r, onOpen }) {
  return (
    <Tooltip>
      <TooltipTrigger delay={150} render={
        <button onClick={ev => onOpen(r.process, ev.altKey)} title={`Open ${r.process} — Alt-click to open here`}
          className="px-1.5 py-0.5 rounded border border-border font-mono text-[10px] text-muted-foreground hover:text-foreground hover:bg-muted">
          {r.process}{r.how?.includes('view') ? <span className="opacity-60"> · view</span> : null}
        </button>
      } />
      <TooltipContent side="top" align="start" sideOffset={6} className={TIP}>
        <div className="font-mono text-xs text-foreground">{r.process}</div>
        {r.summary && (
          <div className="mt-1.5 rounded border border-sky-500/25 bg-sky-500/5 px-2 py-1.5">
            <div className="text-[9px] uppercase tracking-wider text-sky-400/80 mb-0.5">
              {r.summarySource === 'manual' ? 'Summary' : 'AI summary'}{r.summaryAt ? ' · ' + r.summaryAt.slice(0, 10) : ''}
            </div>
            <p className="text-foreground/90 whitespace-pre-line">{r.summary}</p>
          </div>
        )}
        {!r.summary && r.header && <p className="mt-1 text-muted-foreground line-clamp-2">{r.header.split(' — ')[0]}</p>}
        {r.evidence?.length > 0 && (
          <div className="mt-2">
            <div className="text-[9px] uppercase tracking-wider text-muted-foreground/70 mb-1">Reads it with</div>
            <div className="space-y-1">
              {r.evidence.slice(0, 4).map((e, i) => (
                <pre key={i} className="font-mono text-[10px] bg-muted/50 rounded px-1.5 py-1 whitespace-pre-wrap break-words text-foreground/80">{e.code}</pre>
              ))}
            </div>
          </div>
        )}
        <div className="mt-2 text-[10px] text-muted-foreground/70">Click to open the process</div>
      </TooltipContent>
    </Tooltip>
  )
}
