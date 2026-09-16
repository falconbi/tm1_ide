import { useState, useEffect, useRef } from 'react'
import { useStore } from '@/store'
import { X, CalendarDays, SlidersHorizontal } from 'lucide-react'
import { cn } from '@/lib/utils'
import { loadSettings, saveSettings } from '@/lib/formatters/settings.js'
import { COLOUR_THEMES, applyColourTheme, loadColourSettings, saveColourSettings } from '@/lib/formatters/colours.js'

const LIGHT_THEME_IDS = new Set(['light', 'solarized-light', 'github-light', 'one-light'])
const DARK_THEMES  = COLOUR_THEMES.filter(t => !LIGHT_THEME_IDS.has(t.id))
const LIGHT_THEMES = COLOUR_THEMES.filter(t => LIGHT_THEME_IDS.has(t.id))

// Candidate monospace fonts. Detection uses canvas font measurement — the only
// reliable way to tell if a font is actually installed (document.fonts.check()
// is too lenient and returns true for fonts that would just fall back). We
// render a test string in each candidate and compare its width against the
// same string in the browser default; an installed font measures differently.
const MONO_CANDIDATES = [
  'Geist Mono', 'JetBrains Mono', 'Fira Code', 'Cascadia Code', 'Cascadia Mono',
  'Consolas', 'Menlo', 'Monaco', 'DejaVu Sans Mono', 'Liberation Mono',
  'Noto Sans Mono', 'Ubuntu Mono', 'Source Code Pro', 'Courier New', 'Courier',
]

function installedMonoFonts() {
  try {
    const canvas = document.createElement('canvas')
    const ctx = canvas.getContext('2d')
    const probe = 'mmmmmmmmmmlli0O1'
    // Baseline is a KNOWN-NOT-INSTALLED font, not 'monospace'. An installed font
    // renders at its own metrics (width differs); a missing one falls back to
    // the same default, so width is identical. Comparing against a bogus font
    // makes the installed-vs-missing gap much wider and reliable.
    ctx.font = '16px "__tm1_missing_probe__"'
    const base = ctx.measureText(probe).width
    const detected = MONO_CANDIDATES.filter(f => {
      ctx.font = `16px "${f}", "__tm1_missing_probe__"`
      return Math.abs(ctx.measureText(probe).width - base) > 0.5
    })
    return detected.length ? detected : ['DejaVu Sans Mono', 'Liberation Mono', 'Noto Sans Mono', 'Ubuntu Mono']
  } catch {
    return ['DejaVu Sans Mono', 'Liberation Mono', 'Noto Sans Mono', 'Ubuntu Mono']
  }
}

export default function EditorPreferences({ open, onClose, onOpenPeriodBuilder, onOpenFormatSettings }) {
  if (!open) return null

  const { dark, setDark, bumpThemeVersion } = useStore()
  const [settings, setSettings] = useState(() => loadSettings())
  const [colourTheme, setColourTheme] = useState(() => loadColourSettings().theme)
  const [fontOptions] = useState(() => installedMonoFonts())
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
    bumpThemeVersion()   // re-apply font/size to any open editors
  }

  const handleDarkToggle = () => {
    const newDark = !dark
    const current = loadColourSettings()

    // Remember the current theme for the mode we're leaving
    localStorage.setItem(dark ? 'tm1-dark-colour-theme' : 'tm1-light-colour-theme', current.theme)

    // Load the preferred theme for the mode we're entering (with sensible defaults)
    const remembered = localStorage.getItem(newDark ? 'tm1-dark-colour-theme' : 'tm1-light-colour-theme')
    const fallback   = newDark ? 'dracula' : 'light'
    const newThemeId = remembered || fallback

    const updated = applyColourTheme(newThemeId, current)
    saveColourSettings(updated)
    setColourTheme(newThemeId)
    setDark(newDark)
    bumpThemeVersion()
  }

  const pickTheme = (themeId) => {
    const current = loadColourSettings()
    const updated  = applyColourTheme(themeId, current)
    saveColourSettings(updated)
    setColourTheme(themeId)
    localStorage.setItem(dark ? 'tm1-dark-colour-theme' : 'tm1-light-colour-theme', themeId)
    bumpThemeVersion()
  }

  const availableThemes = dark ? DARK_THEMES : LIGHT_THEMES

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
            onClick={handleDarkToggle}
            className={cn('w-8 h-4 rounded-full transition-colors relative shrink-0', dark ? 'bg-primary' : 'bg-muted')}
          >
            <span className={cn('absolute top-0.5 left-0.5 w-3 h-3 bg-white rounded-full transition-transform', dark && 'translate-x-4')} />
          </button>
        </div>

        <div className="flex items-center justify-between py-1 gap-2">
          <label className="text-xs shrink-0">Colour theme</label>
          {availableThemes.length > 1 ? (
            <select
              value={colourTheme}
              onChange={e => pickTheme(e.target.value)}
              className="text-xs bg-background border border-border rounded px-1.5 py-0.5 outline-none flex-1 min-w-0"
            >
              {availableThemes.map(t => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
            </select>
          ) : (
            <span className="text-xs text-muted-foreground">{availableThemes[0]?.name ?? '—'}</span>
          )}
        </div>

        <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mt-3 mb-1">Editor</div>

        <div className="flex items-center justify-between py-1 gap-2">
          <label className="text-xs shrink-0">Font</label>
          <select
            value={settings.editor.fontFamily}
            onChange={e => update('fontFamily', e.target.value)}
            className="text-xs bg-background border border-border rounded px-1.5 py-0.5 outline-none flex-1 min-w-0"
          >
            {fontOptions.map(f => (
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
          onClick={() => { onOpenPeriodBuilder?.(); onClose?.() }}
          className="text-xs px-2 py-0.5 rounded border border-border hover:bg-muted flex items-center gap-1"
        >
          <CalendarDays size={12} />
          Open
        </button>
      </div>

      <div className="flex items-center justify-between py-1 gap-2">
        <label className="text-xs shrink-0">Format Settings</label>
        <button
          onClick={() => { onOpenFormatSettings?.(); onClose?.() }}
          className="text-xs px-2 py-0.5 rounded border border-border hover:bg-muted flex items-center gap-1"
        >
          <SlidersHorizontal size={12} />
          Open
        </button>
      </div>
    </div>
  )
}
