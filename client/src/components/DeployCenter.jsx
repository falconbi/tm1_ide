import { X, Rocket } from 'lucide-react'
import { useStore } from '@/store'
import DeployPanel from '@/components/DeployPanel'

// A full-screen takeover for the deploy workflow — not a tab. While this is
// open, the entire normal IDE (sidebar, tab bar, every open editor) is gone;
// closing it restores the IDE exactly as it was, since tab/group state in the
// store is untouched by this. Phase 1: just the shell + the existing wizard,
// relocated and given room to breathe. History / Import / Baselines and a
// redesigned step flow land in later phases.
export default function DeployCenter() {
  const { deployCenter, closeDeployCenter } = useStore()
  if (!deployCenter) return null

  const title = deployCenter.importDir
    ? 'Deploy — Imported Package'
    : deployCenter.release
      ? 'Deploy — Release'
      : `Deploy — ${deployCenter.session?.name ?? deployCenter.server}`

  return (
    <div className="fixed inset-0 z-[100] flex flex-col bg-background text-foreground">
      <div className="flex items-center gap-2 px-5 py-3 border-b border-border shrink-0">
        <Rocket size={15} className="text-emerald-500" />
        <span className="font-semibold text-sm tracking-tight">{title}</span>
        <span className="text-xs text-muted-foreground">{deployCenter.server}</span>
        <button
          onClick={closeDeployCenter}
          className="ml-auto flex items-center gap-1.5 px-2.5 py-1 rounded text-xs text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
          title="Close — back to the IDE"
        >
          <X size={13} /> Close
        </button>
      </div>
      <div className="flex-1 min-h-0 overflow-hidden flex justify-center">
        <div className="w-full max-w-4xl min-w-0 flex flex-col">
          <DeployPanel tab={deployCenter} />
        </div>
      </div>
    </div>
  )
}
