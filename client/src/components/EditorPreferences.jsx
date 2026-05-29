import { useState, useEffect, useRef } from 'react'
import { useStore } from '@/store'
import { X, CalendarDays, BookType, SlidersHorizontal } from 'lucide-react'
import { cn } from '@/lib/utils'
import { loadSettings, saveSettings } from '@/lib/formatters/settings.js'

export default function EditorPreferences({ open, onClose, onOpenPeriodBuilder, onOpenNamingDictionary, onOpenFormatSettings }) {
  if (!open) return null

  const { dark, setDark } = useStore()
  const [settings, setSettings] = useState(() => loadSettings())
  const ref = useRef(null)

  useEffect(() => {
    const handler = (e) => {
      if (ref.current && !ref.current.contains(e.target) && !e.target.closest('[data-prefs-trigger]')) {
        onClose()
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [onClose])

  const update = (key, val) => {
    const next = { ...settings, editor: { ...settings.editor, [key]: val } }
    setSettings(next)
    saveSettings(next)
  }

  return (
    <div ref={ref} className="fixed top-10 right-2 z-50 w-60 bg-card border border-border rounded-lg shadow-lg p-3">
      <div className="flex items-center justify-between mb-3">
        <span className="text-xs font-semibold">Editor Preferences</span>
        <button onClick={onClose} className="p-0.5 rounded hover:bg-muted text-muted-foreground">
          <X size={12} />
        </button>
      </div>

      <div className="space-y-1">
        <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-1">Appearance</div>

        <div className="flex items-center justify-between py-1">
          <label className="text-xs">Dark mode</label>
          <button
            onClick={() => setDark(!dark)}
            className={cn('w-8 h-4 rounded-full transition-colors relative shrink-0', dark ? 'bg-primary' : 'bg-muted')}
          >
            <span className={cn('absolute top-0.5 left-0.5 w-3 h-3 bg-white rounded-full transition-transform', dark && 'translate-x-4')} />
          </button>
        </div>

        <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mt-3 mb-1">Editor</div>

        <div className="flex items-center justify-between py-1 gap-2">
          <label className="text-xs shrink-0">Font</label>
          <select
            value={settings.editor.fontFamily}
            onChange={e => update('fontFamily', e.target.value)}
            className="text-xs bg-background border border-border rounded px-1.5 py-0.5 outline-none flex-1 min-w-0"
          >
            {['Geist Mono', 'Fira Code', 'JetBrains Mono', 'Cascadia Code', 'Consolas', 'Courier New'].map(f => (
              <option key={f} value={f}>{f}</option>
            ))}
          </select>
        </div>

        <div className="flex items-center justify-between py-1 gap-2">
          <label className="text-xs shrink-0">Size</label>
          <input
            type="range" min="10" max="20"
            value={settings.editor.fontSize}
            onChange={e => update('fontSize', parseInt(e.target.value))}
            className="flex-1"
          />
          <span className="text-xs text-muted-foreground w-5 text-right shrink-0">{settings.editor.fontSize}</span>
        </div>

        <div className="flex items-center justify-between py-1 gap-2">
          <label className="text-xs shrink-0">Line height</label>
          <input
            type="range" min="12" max="22"
            value={Math.round(settings.editor.lineHeight * 10)}
            onChange={e => update('lineHeight', parseInt(e.target.value) / 10)}
            className="flex-1"
          />
          <span className="text-xs text-muted-foreground w-5 text-right shrink-0">{settings.editor.lineHeight.toFixed(1)}</span>
        </div>
      </div>

      <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mt-3 mb-1">Utilities</div>

      <div className="flex items-center justify-between py-1 gap-2">
        <label className="text-xs shrink-0">Period Builder</label>
        <button
          onClick={() => {
            onOpenPeriodBuilder?.()
            onClose?.()
          }}
          className="text-xs px-2 py-0.5 rounded border border-border hover:bg-muted flex items-center gap-1"
        >
          <CalendarDays size={12} />
          Open
        </button>
      </div>

      <div className="flex items-center justify-between py-1 gap-2">
        <label className="text-xs shrink-0">Naming Dictionary</label>
        <button
          onClick={() => {
            onOpenNamingDictionary?.()
            onClose?.()
          }}
          className="text-xs px-2 py-0.5 rounded border border-border hover:bg-muted flex items-center gap-1"
        >
          <BookType size={12} />
          Open
        </button>
      </div>

      <div className="flex items-center justify-between py-1 gap-2">
        <label className="text-xs shrink-0">Format Settings</label>
        <button
          onClick={() => {
            onOpenFormatSettings?.()
            onClose?.()
          }}
          className="text-xs px-2 py-0.5 rounded border border-border hover:bg-muted flex items-center gap-1"
        >
          <SlidersHorizontal size={12} />
          Open
        </button>
      </div>
    </div>
  )
}
