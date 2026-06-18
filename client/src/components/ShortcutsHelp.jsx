import { useEffect } from 'react'
import { X, Keyboard } from 'lucide-react'
import { cn } from '@/lib/utils'

const SHORTCUTS = [
  {
    group: 'Global',
    items: [
      { key: 'Ctrl + F', desc: 'Find & Replace' },
      { key: 'Ctrl + Shift + K', desc: 'Keyboard Shortcuts Help' },
      { key: 'F1', desc: 'Keyboard Shortcuts Help' },
      { key: 'Alt + ,', desc: 'Previous tab' },
      { key: 'Alt + .', desc: 'Next tab' },
      { key: 'Alt + W', desc: 'Close current tab' },
    ],
  },
  {
    group: 'Editor',
    items: [
      { key: 'Ctrl + S', desc: 'Save' },
      { key: 'Ctrl + Shift + S', desc: 'Save As' },
      { key: 'Ctrl + Enter', desc: 'Execute / Refresh' },
      { key: 'Ctrl + Shift + F', desc: 'Format Document' },
      { key: 'Ctrl + Z', desc: 'Undo' },
      { key: 'Ctrl + Y', desc: 'Redo' },
      { key: 'Ctrl + /', desc: 'Toggle line comment' },
      { key: 'Ctrl + D', desc: 'Select next occurrence' },
      { key: 'Alt + ↑ / ↓', desc: 'Move line up / down' },
      { key: 'Ctrl + =', desc: 'Increase editor font size' },
      { key: 'Ctrl + -', desc: 'Decrease editor font size' },
      { key: 'Ctrl + 0', desc: 'Reset editor font size' },
    ],
  },
  {
    group: 'View Editor',
    items: [
      { key: 'Ctrl + Enter', desc: 'Execute view' },
      { key: 'Ctrl + S', desc: 'Save view' },
      { key: 'Ctrl + Shift + S', desc: 'Save view as…' },
    ],
  },
  {
    group: 'Rules Editor',
    items: [
      { key: 'Ctrl + S', desc: 'Save rules' },
      { key: 'Ctrl + Shift + O', desc: 'Go to Symbol (#Region)' },
      { key: 'Ctrl + K Ctrl + 0', desc: 'Collapse all regions' },
      { key: 'Ctrl + K Ctrl + J', desc: 'Expand all regions' },
      { key: 'Ctrl + Shift + F', desc: 'Format rules' },
    ],
  },
  {
    group: 'Navigation',
    items: [
      { key: 'Ctrl + P', desc: 'Quick open file (Monaco)' },
      { key: 'Ctrl + G', desc: 'Go to line (Monaco)' },
      { key: 'F12', desc: 'Go to definition (Monaco)' },
    ],
  },
]

export default function ShortcutsHelp({ open, onClose }) {
  useEffect(() => {
    if (!open) return
    const onKey = (e) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={onClose}>
      <div
        className="bg-popover border border-border rounded-lg shadow-xl w-[480px] max-w-[90vw] max-h-[80vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <Keyboard size={16} className="text-primary" />
            Keyboard Shortcuts
          </div>
          <button onClick={onClose} className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground">
            <X size={14} />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-auto px-4 py-3 space-y-4">
          {SHORTCUTS.map((group) => (
            <div key={group.group}>
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-1.5">
                {group.group}
              </div>
              <div className="space-y-1">
                {group.items.map((item) => (
                  <div key={item.key} className="flex items-center justify-between text-xs py-0.5">
                    <span className="text-sidebar-foreground">{item.desc}</span>
                    <kbd className="font-mono text-[10px] px-1.5 py-px rounded bg-muted border border-border text-muted-foreground shrink-0 ml-2">
                      {item.key}
                    </kbd>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>

        {/* Footer */}
        <div className="px-4 py-2 border-t border-border text-[10px] text-muted-foreground text-center">
          Press <kbd className="font-mono px-1 rounded bg-muted border border-border">Esc</kbd> to close
        </div>
      </div>
    </div>
  )
}
