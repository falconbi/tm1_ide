import { useStore } from '@/store'

export default function StatusBar() {
  const { server, tabs, activeTab } = useStore()
  const tab = tabs.find(t => t.id === activeTab)
  const dirtyCount = tabs.filter(t => t.dirty).length

  return (
    <div className="flex items-center gap-4 px-3 py-0.5 bg-primary text-primary-foreground text-xs shrink-0">
      <span className="font-medium">{server ?? 'No server selected'}</span>
      {tab && (
        <span className="opacity-60">
          │ {tab.type === 'rules' ? `Rules: ${tab.cube}` : `Process: ${tab.name}`}
          {tab.dirty && <span className="ml-1.5 text-orange-300">● unsaved</span>}
        </span>
      )}
      {dirtyCount > 1 && (
        <span className="opacity-60">│ {dirtyCount} unsaved tabs</span>
      )}
      <span className="ml-auto opacity-60">TM1 IDE</span>
    </div>
  )
}
