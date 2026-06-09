import { Loader2, Trash2 } from 'lucide-react'
import { useSubsetUsage, useDimensionUsage, useCubeUsage, useProcessUsage } from '@/hooks/useApi'

export function DeleteWarningModal({ open, type, name, server, dimension, onClose, onConfirm }) {
  const isSubset  = open && type === 'subset'
  const isDim     = open && type === 'dimension'
  const isCube    = open && type === 'cube'
  const isProcess = open && type === 'process'

  const subsetScan  = useSubsetUsage(isSubset  ? server : null, isSubset  ? dimension : null, isSubset  ? name : null)
  const dimScan     = useDimensionUsage(isDim     ? server : null, isDim     ? name : null)
  const cubeScan    = useCubeUsage(isCube    ? server : null, isCube    ? name : null)
  const procScan    = useProcessUsage(isProcess ? server : null, isProcess ? name : null)

  const scan = isSubset ? subsetScan : isDim ? dimScan : isCube ? cubeScan : procScan
  const { data, isLoading } = scan

  const hasDeps = !isLoading && data && (
    (data.cubes?.length > 0) ||
    (data.processes?.length > 0) ||
    (data.chores?.length > 0) ||
    (data.views?.length > 0)
  )

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
      <div className="bg-popover border border-border rounded-lg shadow-xl w-[420px] max-w-[95vw] p-4 flex flex-col gap-3"
        onClick={e => e.stopPropagation()}>

        <div className="flex items-start gap-3">
          <Trash2 size={15} className="shrink-0 text-red-400 mt-0.5" />
          <div>
            <div className="text-sm font-semibold capitalize">Delete {type}: <span className="font-mono">{name}</span></div>
            <div className="text-xs text-muted-foreground mt-0.5">
              {isLoading ? 'Scanning for dependencies…' : hasDeps ? 'Dependencies found.' : 'No dependencies found.'}
            </div>
          </div>
        </div>

        {isLoading && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 size={12} className="animate-spin" />
            Checking cubes, views, processes, and chores…
          </div>
        )}

        {!isLoading && data && (
          <div className="flex flex-col gap-2 max-h-48 overflow-y-auto">
            {data.cubes?.length > 0 && (
              <div>
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-1">Used in Cubes</div>
                {data.cubes.map((c, i) => (
                  <div key={i} className="text-xs font-mono pl-2 py-0.5 text-amber-400">{typeof c === 'string' ? c : c.cube}</div>
                ))}
              </div>
            )}
            {data.views?.length > 0 && (
              <div>
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-1">Used in Views</div>
                {data.views.map((v, i) => (
                  <div key={i} className="text-xs font-mono pl-2 py-0.5 text-amber-400">{v.cube}/{v.view}</div>
                ))}
              </div>
            )}
            {data.processes?.length > 0 && (
              <div>
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-1">Referenced in TI Processes</div>
                {data.processes.map((p, i) => (
                  <div key={i} className="text-xs font-mono pl-2 py-0.5 text-amber-400">{p.process}</div>
                ))}
              </div>
            )}
            {data.chores?.length > 0 && (
              <div>
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-1">Used in Chores</div>
                {data.chores.map((c, i) => (
                  <div key={i} className="text-xs font-mono pl-2 py-0.5 text-amber-400">{c.chore}</div>
                ))}
              </div>
            )}
            {!hasDeps && (
              <div className="text-xs text-muted-foreground italic">Safe to delete — no active dependencies found.</div>
            )}
          </div>
        )}

        {hasDeps && (
          <div className="text-xs text-amber-400 bg-amber-400/10 border border-amber-400/20 rounded px-3 py-2">
            Deleting this {type} may break the items listed above.
          </div>
        )}

        <div className="flex gap-2 justify-end pt-1">
          <button onClick={onClose}
            className="text-xs px-3 py-1.5 rounded border border-border hover:bg-muted text-muted-foreground">
            Cancel
          </button>
          <button onClick={onConfirm} disabled={isLoading}
            className="text-xs px-3 py-1.5 rounded bg-red-600 text-white hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed">
            {hasDeps ? 'Delete Anyway' : 'Delete'}
          </button>
        </div>
      </div>
    </div>
  )
}
