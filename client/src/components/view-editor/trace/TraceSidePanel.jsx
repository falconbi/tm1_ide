import { useEffect, useState, Component } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ChevronLeft, ChevronRight, Eraser, Loader2, RefreshCw, X, AlertTriangle } from 'lucide-react'
import { cubeDimensionsQuery } from '@/hooks/useApi'
import { cn } from '@/lib/utils'
import { fmtTraceValue } from '@/lib/view-editor/trace-format.js'
import RuleBreakdown from './RuleBreakdown.jsx'
import TypeBadgeTrace from './TypeBadgeTrace.jsx'
import useTraceData from './useTraceData.js'

class TraceErrorBoundary extends Component {
    constructor(props) { super(props); this.state = { error: null } }
    static getDerivedStateFromError(error) { return { error } }
    render() {
        if (this.state.error) {
            return (
                <div className="flex-1 flex flex-col items-center justify-center gap-2 text-xs text-muted-foreground p-6">
                    <AlertTriangle size={16} className="text-amber-500" />
                    <p className="font-medium text-foreground">Trace could not be rendered</p>
                    <p className="text-center text-red-400 break-all">{String(this.state.error?.message ?? this.state.error)}</p>
                    <button
                        className="mt-1 px-3 py-1 rounded border text-[10px] hover:bg-muted"
                        onClick={() => this.setState({ error: null })}
                    >Retry</button>
                </div>
            )
        }
        return this.props.children
    }
}

function TraceSidePanel({ ctx, onClose, initialStack, onStackChange }) {
    const [stack, setStack] = useState(() => initialStack?.length ? initialStack : [{
        cube:         ctx.cube,
        dimElemPairs: ctx.dimElemPairs,
        label:        ctx.dimElemPairs.map(p => p.element).join(' · '),
    }])
    useEffect(() => { onStackChange?.(stack) }, [stack])  // eslint-disable-line

    const current = stack[stack.length - 1]
    const [nonce, setNonce] = useState(0)   // Refresh: re-trace the same cell (and re-read its lookups)
    const { data, error, busy } = useTraceData(ctx.server, current.cube, current.dimElemPairs, nonce)
    // Dimension order for the CUBE CURRENTLY ON THE STACK (not just the original
    // cube) — needed to build coordinates when drilling, including cross-cube.
    const qc = useQueryClient()
    const { data: stackCubeDims = [] } = useQuery(cubeDimensionsQuery(ctx.server, current.cube))

    const stmts = data?.Statements ?? []
    const comps = data?.Components ?? []

    const canDrill = (comp) => {
        const t = comp.Type?.toLowerCase() ?? ''
        return (comp.Tuple ?? []).length > 0 && (t.includes('consol') || t.includes('rule') || t.includes('base'))
    }

    // Drill to a cell in `targetCube` given its element coordinates (in the
    // cube's dimension order). Cross-cube cubes fetch their dimensions on demand.
    // `derived` (parallel to elements) records which coordinates were resolved
    // from ATTRS() lookups, so the drilled frame shows their provenance.
    const drillTo = async (targetCube, elements, derived = null) => {
        let dims
        if (targetCube === current.cube) {
            dims = stackCubeDims
        } else {
            try {
                dims = await qc.fetchQuery(cubeDimensionsQuery(ctx.server, targetCube))
            } catch { dims = [] }
        }
        if (!dims?.length) return
        const newPairs = dims.map((d, i) => ({ dim: d, element: elements[i], derived: derived?.[i] ?? null })).filter(p => p.element)
        if (!newPairs.length) return
        setStack(s => [...s, { cube: targetCube, dimElemPairs: newPairs, derived: derived ?? [], label: elements.filter(Boolean).join(' · ') }])
    }

    const drillInto = (comp) => drillTo(comp.Cube?.Name ?? current.cube, (comp.Tuple ?? []).map(t => t.Name))

    const goBack = () => setStack(s => s.slice(0, -1))

    return (
        <div
            style={{ position: 'fixed', top: 0, right: 0, bottom: 0, width: 440, zIndex: 9000 }}
            className="bg-popover border-l border-border shadow-2xl flex flex-col"
        >
            {/* Header */}
            <div className="px-4 py-3 border-b border-border bg-muted/30 shrink-0 space-y-1.5">
                <div className="flex items-center gap-2">
                    <span className="text-xs font-semibold flex-1">{current.cube}</span>
                    {data && <TypeBadgeTrace type={data.Type} />}
                    {data?.Value != null && (
                        <span className="font-mono text-xs font-semibold tabular-nums">{fmtTraceValue(data.Value)}</span>
                    )}
                    <button onClick={() => setNonce(n => n + 1)} disabled={busy} title="Refresh — trace this cell again with current data"
                        className="text-muted-foreground hover:text-foreground disabled:opacity-40 ml-1">
                        <RefreshCw size={12} className={busy ? 'animate-spin' : ''} />
                    </button>
                    <button onClick={() => setStack(st => st.slice(0, 1))} disabled={stack.length < 2} title="Clear — back to the cell you traced"
                        className="text-muted-foreground hover:text-foreground disabled:opacity-40">
                        <Eraser size={12} />
                    </button>
                    <button onClick={onClose} title="Close" className="text-muted-foreground hover:text-foreground ml-1">
                        <X size={14} />
                    </button>
                </div>
                {/* Breadcrumb */}
                <div className="flex items-center gap-1 flex-wrap">
                    {stack.map((s, i) => (
                        <span key={i} className="flex items-center gap-1">
                            {i > 0 && <ChevronRight size={10} className="text-muted-foreground/50 shrink-0" />}
                            <button
                                onClick={() => i < stack.length - 1 && setStack(st => st.slice(0, i + 1))}
                                className={cn('text-[10px] truncate max-w-[120px]',
                                    i === stack.length - 1
                                        ? 'text-foreground font-medium'
                                        : 'text-muted-foreground hover:text-foreground'
                                )}
                                title={s.label}
                            >
                                {s.label}
                            </button>
                        </span>
                    ))}
                </div>
                {stack.length > 1 && (
                    <button
                        onClick={goBack}
                        className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground transition-colors"
                    >
                        <ChevronLeft size={10} /> Back
                    </button>
                )}
                {/* Provenance: which coordinates were derived from ATTRS() lookups */}
                {(current.derived ?? []).filter(Boolean).length > 0 && (
                    <div className="space-y-0.5 pt-1 border-t border-border/40">
                        <div className="text-[9px] uppercase tracking-wide text-muted-foreground/60 font-medium">
                            Mapped from attributes
                        </div>
                        {(current.derived ?? []).filter(Boolean).map((d, i) => (
                            <div key={i} className="font-mono text-[10px] text-muted-foreground">
                                <span className="text-foreground font-medium">{d.value}</span>
                                {' ← '}
                                {d.source}
                            </div>
                        ))}
                    </div>
                )}
            </div>

            {/* Body */}
            <TraceErrorBoundary>
            <div key={nonce} className="flex-1 overflow-y-auto p-4 space-y-4 text-xs">
                {busy && (
                    <div className="flex items-center gap-2 text-muted-foreground">
                        <Loader2 size={12} className="animate-spin" /> Tracing…
                    </div>
                )}
                {error && <div className="text-red-400">{error}</div>}

                {stmts.length > 0 && (
                    <RuleBreakdown
                        server={ctx.server}
                        statements={stmts}
                        dimElemPairs={current.dimElemPairs}
                        cube={current.cube}
                        onDrill={drillTo}
                    />
                )}

                {data && stmts.length === 0 && comps.length === 0 && (
                    <div className="rounded border border-border/60 bg-muted/20 px-3 py-2 space-y-1">
                        <div className="text-[11px] font-medium">Stored input: this is the source</div>
                        <div className="text-[10px] text-muted-foreground">No rule calculates this cell. The value was entered or loaded. To see who changed it and when, right-click the cell in a view and choose Log.</div>
                    </div>
                )}
                {stmts.length === 0 && comps.length > 0 && (
                    <div className="space-y-2">
                        <div className="text-[10px] uppercase tracking-wide text-muted-foreground font-medium">
                            Components ({comps.length})
                        </div>
                        <div className="space-y-1.5">
                            {comps.map((c, i) => {
                                const tuple    = (c.Tuple ?? []).map(t => t.Name).join(' · ')
                                const drillable = canDrill(c)
                                const crossCube = c.Cube?.Name && c.Cube.Name !== current.cube
                                return (
                                    <div
                                        key={i}
                                        onClick={() => drillable && drillInto(c)}
                                        className={cn(
                                            'bg-muted/30 border border-border/50 rounded px-3 py-2 space-y-1 transition-colors',
                                            drillable && 'cursor-pointer hover:bg-muted/60 hover:border-border'
                                        )}
                                    >
                                        <div className="flex items-center gap-2">
                                            <TypeBadgeTrace type={c.Type} />
                                            {crossCube && (
                                                <span className="text-[10px] text-blue-400 font-medium">{c.Cube.Name}</span>
                                            )}
                                            <span className="ml-auto font-mono text-[11px] font-semibold tabular-nums">
                                                {c.Value != null ? fmtTraceValue(c.Value) : '—'}
                                            </span>
                                            {drillable && (
                                                <ChevronRight size={10} className="text-muted-foreground/50 shrink-0" />
                                            )}
                                        </div>
                                        {tuple && (
                                            <div className="font-mono text-[10px] text-muted-foreground break-all">{tuple}</div>
                                        )}
                                    </div>
                                )
                            })}
                        </div>
                    </div>
                )}

                {!busy && !error && stmts.length === 0 && comps.length === 0 && data && (
                    <div className="text-muted-foreground">No detail available for this cell.</div>
                )}
            </div>
            </TraceErrorBoundary>
        </div>
    )
}


export default TraceSidePanel
