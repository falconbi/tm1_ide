import { Loader2 } from 'lucide-react'
import { useViewPreviewRecords } from '@/hooks/useApi'

function SourceViewPreview({ server, cube, view, processes, onOpenFull }) {
    const { data, error, isLoading: loading } = useViewPreviewRecords(server, cube, view)
    const total = data?.viewRows
    return (
        <div className="flex flex-col h-full min-h-0">
            <div className="shrink-0 px-3 py-2 border-b border-border bg-amber-500/10">
                <div className="flex items-center gap-2 text-xs">
                    <span className="px-1.5 py-0.5 rounded border border-amber-500/40 text-amber-600 dark:text-amber-400 font-semibold">SOURCE VIEW</span>
                    <span className="font-mono text-foreground">{cube} / {view}</span>
                    <span className="text-muted-foreground">read-only preview</span>
                </div>
                <p className="mt-1 text-[11px] text-muted-foreground">
                    This view is wired as a TI datasource{processes?.length ? ` (${processes.map(p => p.process).join(', ')})` : ''}.
                    The IDE will not load the whole view. Showing the first {data?.rows?.length ?? 0}{total != null ? ` of ${total.toLocaleString()}` : ''} records as the process sees them.
                </p>
            </div>
            <div className="flex-1 min-h-0 overflow-auto p-3">
                {loading && <div className="flex items-center gap-2 text-xs text-muted-foreground"><Loader2 size={12} className="animate-spin" /> Reading source preview…</div>}
                {error && <div className="text-xs text-red-400">{error}</div>}
                {!loading && !error && data && (
                    data.rows.length ? (
                        <table className="text-[11px] border-collapse min-w-full">
                            <thead><tr>{data.columns.map((c, i) => <th key={i} className="text-left font-semibold px-2 py-1 border-b border-border text-muted-foreground whitespace-nowrap">{c}</th>)}</tr></thead>
                            <tbody>{data.rows.map((r, i) => <tr key={i}>{r.map((v, j) => <td key={j} className="px-2 py-1 border-b border-border/40 font-mono whitespace-nowrap">{String(v ?? '')}</td>)}</tr>)}</tbody>
                        </table>
                    ) : <p className="text-xs text-muted-foreground">The source view returned no non-empty records.</p>
                )}
            </div>
            <div className="shrink-0 px-3 py-2 border-t border-border flex items-center gap-2">
                <span className="text-[11px] text-muted-foreground flex-1">Source views are for TI input, not analysis. Open the full grid only if you need to inspect or narrow it.</span>
                <button
                    onClick={() => { if (window.confirm('Load the full view into the grid? Large source views can be slow.')) onOpenFull() }}
                    className="px-2.5 py-1 text-xs rounded border border-border text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                >
                    Open full view…
                </button>
            </div>
        </div>
    )
}

export default SourceViewPreview
