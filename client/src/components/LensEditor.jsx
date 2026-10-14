import { useState, useRef, useCallback, useEffect, useMemo } from 'react'
import MonacoEditor from '@monaco-editor/react'
import { useStore } from '@/store'
import { Sparkles, Save, RefreshCw, Loader2, Eye, Pencil, SlidersHorizontal } from 'lucide-react'
import { cn } from '@/lib/utils'
import { lensSrcDoc, installLensHost } from '@shared/lens-bridge'
import LENS_ICONS from '@shared/lens-icons.json'

const ICON_NAMES = Object.keys(LENS_ICONS).filter(k => !k.startsWith('_'))
const TILE_COLORS = ['#0f766e', '#2563eb', '#7c3aed', '#c2410c', '#be123c', '#0e7490', '#4d7c0f', '#a16207']

// One Lens icon (shared/lens-icons.json — the same set the Lens app draws).
function LensIcon({ name, size = 18, stroke = 'currentColor' }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke={stroke} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {(LENS_ICONS[name] ?? []).map(([Tag, attrs], i) => <Tag key={i} {...attrs} />)}
    </svg>
  )
}

// The Lens's tile on the Lens app home page: its image, or its icon on a colour.
function LensTile({ icon, color, image, size = 28 }) {
  if (image) return <img src={image} alt="" style={{ width: size, height: size, borderRadius: size / 4, objectFit: 'cover' }} />
  return (
    <span style={{ width: size, height: size, borderRadius: size / 4, display: 'inline-grid', placeItems: 'center', background: `linear-gradient(135deg, ${color || '#0f766e'}, ${color || '#0f766e'}bb)` }}>
      <LensIcon name={icon || 'layers'} size={size * 0.56} stroke="#fff" />
    </span>
  )
}

// Pick the icon, its colour, or upload your own image (≤ 200 KB) for the Lens app home page.
function IconPicker({ icon, color, image, onChange }) {
  const [open, setOpen] = useState(false)
  const [error, setError] = useState('')
  const fileRef = useRef(null)
  const upload = (file) => {
    setError('')
    if (!file) return
    if (!/^image\/(png|jpeg|webp|svg\+xml)$/.test(file.type)) { setError('Use a PNG, JPEG, WebP or SVG picture'); return }
    if (file.size > 200 * 1024) { setError('That picture is over 200 KB — use a smaller one'); return }
    const reader = new FileReader()
    reader.onload = () => onChange({ image: String(reader.result) })
    reader.readAsDataURL(file)
  }
  return (
    <div className="relative">
      <button onClick={() => setOpen(o => !o)} className="inline-flex items-center gap-1.5 rounded border border-border px-2 py-1 text-sm hover:bg-accent" title="Icon on the Lens app home page">
        <LensTile icon={icon} color={color} image={image} size={20} /> Icon
      </button>
      {open && (
        <div className="absolute left-0 top-full z-50 mt-1 w-[300px] rounded-md border border-border bg-background p-3 shadow-lg">
          <div className="mb-2 flex items-center gap-2">
            <LensTile icon={icon} color={color} image={image} size={44} />
            <div className="text-xs text-muted-foreground">How this Lens looks on the Lens app home page</div>
          </div>
          <div className="grid grid-cols-8 gap-1">
            {ICON_NAMES.map(n => (
              <button key={n} title={n} onClick={() => onChange({ icon: n, image: '' })}
                className={cn('grid h-8 w-8 place-items-center rounded hover:bg-accent', !image && icon === n && 'bg-primary text-primary-foreground')}>
                <LensIcon name={n} />
              </button>
            ))}
          </div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {TILE_COLORS.map(c => (
              <button key={c} title={c} onClick={() => onChange({ color: c, image: '' })}
                className={cn('h-6 w-6 rounded-full border-2', color === c ? 'border-foreground' : 'border-transparent')} style={{ background: c }} />
            ))}
          </div>
          <div className="mt-3 flex items-center gap-2 border-t border-border pt-2">
            <button onClick={() => fileRef.current?.click()} className="rounded border border-border px-2 py-1 text-xs hover:bg-accent">Use my own image…</button>
            {image && <button onClick={() => onChange({ image: '' })} className="rounded border border-border px-2 py-1 text-xs hover:bg-accent">Remove image</button>}
            <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" hidden onChange={e => { upload(e.target.files?.[0]); e.target.value = '' }} />
          </div>
          {error && <div className="mt-1 text-xs text-red-600">{error}</div>}
          <div className="mt-2 text-right"><button onClick={() => setOpen(false)} className="text-xs text-muted-foreground hover:underline">Done</button></div>
        </div>
      )}
    </div>
  )
}

const token = () => localStorage.getItem('tm1-token') ?? ''

const DEFAULT_LENS = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<style>
  body { font-family: system-ui, sans-serif; margin: 0; background: #f8fafc; color: #0f172a; padding: 24px; }
  .card { background: #fff; border: 1px solid #e2e8f0; border-radius: 12px; padding: 20px; margin-bottom: 16px; box-shadow: 0 1px 2px rgba(0,0,0,.04); }
  h1 { font-size: 22px; margin: 0 0 4px; }
  .kpis { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 12px; }
  .kpi { background: #fff; border: 1px solid #e2e8f0; border-radius: 12px; padding: 16px; }
  .kpi .label { font-size: 12px; color: #64748b; text-transform: uppercase; letter-spacing: .05em; }
  .kpi .value { font-size: 26px; font-weight: 700; margin-top: 4px; }
  button { border: 1px solid #cbd5e1; background: #fff; border-radius: 8px; padding: 6px 12px; cursor: pointer; }
</style>
</head>
<body>
  <h1>My Lens</h1>
  <p style="color:#64748b">Generated from your description. Use the bridge to pull live TM1 data.</p>
  <button onclick="refresh()">Refresh</button>
  <script>
    window.lensBridge.call('getMeta', {}).then(function (meta) {
      document.body.insertAdjacentHTML('beforeend', '<p>Connected. Cubes: ' + (meta.cubes || []).join(', ') + '</p>')
    }).catch(function (e) {
      document.body.insertAdjacentHTML('beforeend', '<p style="color:#b91c1c">Bridge error: ' + e.message + '</p>')
    });
  </script>
</body>
</html>`

const LOADING_LENS = '<!doctype html><html><body style="font:14px system-ui,sans-serif;color:#85908f;padding:24px">Loading…</body></html>'

export default function LensEditor({ tab }) {
  const { dark } = useStore()
  const [name, setName] = useState(tab.name ?? '')
  const [prompt, setPrompt] = useState('')
  // Stored with the Lens (shown in the Lens app): loaded on open, kept on save.
  const [description, setDescription] = useState('')
  const [folder, setFolder] = useState('')
  const [title, setTitle] = useState('')
  const [look, setLook] = useState({ icon: '', color: '', image: '' })
  // The Lens's config (Config tab): JSON the Lens reads with Lens.config(). The
  // preview always runs with the last config that parsed.
  const [configText, setConfigText] = useState('{\n}\n')
  const [goodConfig, setGoodConfig] = useState({})
  const parseConfig = text => {
    try {
      const c = JSON.parse(text || '{}')
      return c && typeof c === 'object' && !Array.isArray(c) ? { config: c } : { error: 'The config must be a JSON object { … }' }
    } catch (e) { return { error: e.message } }
  }
  const configError = useMemo(() => parseConfig(configText).error ?? '', [configText])
  const editConfig = text => {
    setConfigText(text)
    const p = parseConfig(text)
    if (p.config) setGoodConfig(p.config)
  }
  const [folders, setFolders] = useState([])
  const [cube, setCube] = useState(tab.cube ?? '')
  const [cubes, setCubes] = useState([])
  // A saved Lens starts on a plain placeholder (no bridge calls) until it loads —
  // never on the example Lens, whose requests would race the real one.
  const [html, setHtml] = useState(tab.name ? LOADING_LENS : DEFAULT_LENS)
  const [generating, setGenerating] = useState(false)
  const [saving, setSaving] = useState(false)
  const [validation, setValidation] = useState([])
  const [message, setMessage] = useState(null)
  const [mode, setMode] = useState('design') // 'design' | 'preview'
  const [previewKey, setPreviewKey] = useState(0)
  const iframeRef = useRef(null)
  const previewTimer = useRef(null)
  const [dirtyPreview, setDirtyPreview] = useState(false)

  useEffect(() => {
    fetch(`/api/model/cubes?server=${encodeURIComponent(tab.server)}`, { headers: { 'x-ide-token': token() } })
      .then(r => r.json())
      .then(d => setCubes(Array.isArray(d) ? d : []))
      .catch(() => {})
    // Folders already in use, offered as suggestions.
    fetch(`/api/lenses?server=${encodeURIComponent(tab.server)}`, { headers: { 'x-ide-token': token() } })
      .then(r => r.json())
      .then(d => setFolders(Array.isArray(d) ? [...new Set(d.map(l => l.folder).filter(Boolean))].sort() : []))
      .catch(() => {})
    if (tab.name) {
      fetch(`/api/lenses/${encodeURIComponent(tab.name)}?server=${encodeURIComponent(tab.server)}&_=${Date.now()}`, { headers: { 'x-ide-token': token() } })
        .then(r => r.json())
        .then(d => {
          if (d.html) { setHtml(d.html); setDescription(d.meta?.description ?? ''); setFolder(d.meta?.folder ?? ''); setTitle(d.meta?.title ?? ''); setLook({ icon: d.meta?.icon ?? '', color: d.meta?.color ?? '', image: d.meta?.image ?? '' }); setConfigText(JSON.stringify(d.meta?.config ?? {}, null, 2) + '\n'); setGoodConfig(d.meta?.config ?? {}) }
          else if (d.error) setMessage({ kind: 'error', text: `Couldn't load the Lens: ${d.error}` })
        })
        .catch(e => setMessage({ kind: 'error', text: `Couldn't load the Lens: ${e.message}` }))
    }
  }, [tab.server, tab.name])

  useEffect(() => {
    const off = installLensHost(
      () => iframeRef.current?.contentWindow,
      { getServer: () => tab.server, getToken: token, getLens: () => tab.name },
    )
    return off
  }, [tab.server, tab.name])

  useEffect(() => {
    if (!dirtyPreview) return
    clearTimeout(previewTimer.current)
    previewTimer.current = setTimeout(() => { setDirtyPreview(false); setPreviewKey(k => k + 1) }, 600)
    return () => clearTimeout(previewTimer.current)
  }, [html, dirtyPreview])

  const generate = async () => {
    if (!prompt.trim()) { setMessage({ kind: 'error', text: 'Describe the lens you want first' }); return }
    setGenerating(true)
    setMessage(null)
    try {
      const res = await fetch('/api/lenses/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-ide-token': token() },
        body: JSON.stringify({ server: tab.server, cube: cube || undefined, description: prompt }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || res.statusText)
      setHtml(data.html)
      if (data.mode === 'starter') {
        setMessage({ kind: 'ok', text: data.note ?? 'No AI configured — here is a starter lens bound to your cube. Hand-edit it in the Code tab, or add an AI_PROVIDER/AI_API_KEY in .env for AI generation.' })
      } else {
        setMessage({ kind: 'ok', text: 'Generated — review and refine in the editor, or keep describing changes.' })
      }
    } catch (e) {
      setMessage({ kind: 'error', text: e.message })
    } finally {
      setGenerating(false)
    }
  }

  const save = async (publish = false, force = false) => {
    if (!name.trim()) { setMessage({ kind: 'error', text: 'Give the lens a name' }); return }
    if (configError) { setMode('config'); setMessage({ kind: 'error', text: `Fix the config first: ${configError}` }); return }
    setSaving(true)
    setMessage(null)
    setValidation([])
    try {
      const res = await fetch(`/api/lenses/${encodeURIComponent(name.trim())}?server=${encodeURIComponent(tab.server)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-ide-token': token() },
        body: JSON.stringify({ html, description, folder, title, icon: look.icon, color: look.color, image: look.image, config: goodConfig, publish, force }),
      })
      const data = await res.json()
      if (!res.ok) {
        if (Array.isArray(data.validation)) setValidation(data.validation)
        throw new Error(data.error || res.statusText)
      }
      setMessage({ kind: 'ok', text: `Saved "${data.name}" to ${tab.server}'s model (${data.status}, version ${data.version})${data.validation?.length ? ` — ${data.validation.length} validation warnings` : ''}` })
      window.dispatchEvent(new CustomEvent('tm1-lenses-changed', { detail: { server: tab.server } }))
    } catch (e) {
      setMessage({ kind: 'error', text: e.message })
    } finally {
      setSaving(false)
    }
  }

  const refreshPreview = () => setPreviewKey(k => k + 1)

  const handleEditorChange = useCallback((value) => {
    setHtml(value ?? '')
    setDirtyPreview(true)
  }, [])

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-2">
        <input
          className="w-44 rounded border border-border bg-background px-2 py-1 text-sm"
          placeholder="Lens name"
          value={name}
          onChange={e => setName(e.target.value)}
        />
        <select
          className="rounded border border-border bg-background px-2 py-1 text-sm"
          value={cube}
          onChange={e => setCube(e.target.value)}
        >
          <option value="">— cube context (optional) —</option>
          {cubes.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
        <input
          className="min-w-[220px] flex-1 rounded border border-border bg-background px-2 py-1 text-sm"
          placeholder="Describe the dashboard, e.g. revenue vs budget by region with a variance table"
          value={prompt}
          onChange={e => setPrompt(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') generate() }}
        />
        <button
          onClick={generate}
          disabled={generating}
          className="inline-flex items-center gap-1.5 rounded bg-emerald-700 px-3 py-1.5 text-sm text-white hover:bg-emerald-600 disabled:opacity-50"
        >
          {generating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
          Generate
        </button>
        <div className="flex rounded border border-border">
          <button
            onClick={() => setMode('design')}
            className={cn('inline-flex items-center gap-1 px-2.5 py-1.5 text-sm', mode === 'design' && 'bg-primary text-primary-foreground')}
            title="Edit HTML"
          >
            <Pencil className="h-3.5 w-3.5" /> Code
          </button>
          <button
            onClick={() => setMode('config')}
            className={cn('inline-flex items-center gap-1 px-2.5 py-1.5 text-sm', mode === 'config' && 'bg-primary text-primary-foreground')}
            title="The Lens's settings (Lens.config()) — with the preview beside it"
          >
            <SlidersHorizontal className="h-3.5 w-3.5" /> Config
          </button>
          <button
            onClick={() => setMode('preview')}
            className={cn('inline-flex items-center gap-1 px-2.5 py-1.5 text-sm', mode === 'preview' && 'bg-primary text-primary-foreground')}
            title="Preview"
          >
            <Eye className="h-3.5 w-3.5" /> Preview
          </button>
        </div>
        <button
          onClick={refreshPreview}
          className="inline-flex items-center gap-1 rounded border border-border px-2 py-1.5 text-sm hover:bg-accent"
          title="Reload preview with fresh data"
        >
          <RefreshCw className="h-3.5 w-3.5" /> Refresh
        </button>
        <button
          onClick={() => save(false)}
          disabled={saving}
          className="inline-flex items-center gap-1.5 rounded border border-border px-3 py-1.5 text-sm hover:bg-accent disabled:opacity-50"
        >
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          Save draft
        </button>
        <button
          onClick={() => save(true)}
          disabled={saving}
          className="inline-flex items-center gap-1.5 rounded bg-primary px-3 py-1.5 text-sm text-primary-foreground disabled:opacity-50"
        >
          Publish
        </button>
        {validation.length > 0 && (
          <button
            onClick={() => save(false, true)}
            disabled={saving}
            className="inline-flex items-center gap-1.5 rounded border border-red-300 px-3 py-1.5 text-sm text-red-600 hover:bg-red-50 disabled:opacity-50"
            title="Save despite validation failures"
          >
            Save anyway
          </button>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-1.5">
        <IconPicker {...look} onChange={patch => setLook(l => ({ ...l, ...patch }))} />
        <span className="text-xs text-muted-foreground">Title</span>
        <input
          className="w-48 rounded border border-border bg-background px-2 py-1 text-sm"
          placeholder="e.g. 1 Enter targets"
          value={title}
          onChange={e => setTitle(e.target.value)}
          title="What people see in the Lens app — business words, not cube names. A leading number orders the steps in a folder"
        />
        <span className="text-xs text-muted-foreground">Folder</span>
        <input
          className="w-52 rounded border border-border bg-background px-2 py-1 text-sm"
          placeholder="e.g. Target setting 2027"
          list={`lens-folders-${tab.id}`}
          value={folder}
          onChange={e => setFolder(e.target.value)}
          title="The business process this Lens belongs to, as people know it — '/' makes a sub-folder"
        />
        <datalist id={`lens-folders-${tab.id}`}>{folders.map(f => <option key={f} value={f} />)}</datalist>
        <span className="text-xs text-muted-foreground">Description</span>
        <input
          className="min-w-[220px] flex-1 rounded border border-border bg-background px-2 py-1 text-sm"
          placeholder="What this Lens shows — people see this in the Lens app"
          value={description}
          onChange={e => setDescription(e.target.value)}
        />
      </div>
      {message && (
        <div className={cn('px-3 py-1.5 text-xs border-b', message.kind === 'error' ? 'text-red-600 border-red-200 bg-red-50' : 'text-emerald-700 border-emerald-200 bg-emerald-50')}>
          {message.text}
        </div>
      )}
      {validation.length > 0 && (
        <div className="px-3 py-1.5 text-xs text-red-600 border-b border-red-200 bg-red-50">
          <div>Validation failed — fix these, or save anyway:</div>
          <ul className="list-disc pl-4 mt-1">{validation.map((v, i) => <li key={i}>{v}</li>)}</ul>
        </div>
      )}
      <div className="flex-1 min-h-0 flex">
        <div className={cn('flex-1 min-h-0 flex flex-col', mode !== 'config' && 'hidden')}>
          <div className={cn('px-3 py-1 text-xs border-b', configError ? 'text-red-600 bg-red-50 border-red-200' : 'text-muted-foreground border-border')}>
            {configError ? `Not valid yet: ${configError} — the preview keeps the last good config` : 'Settings the Lens reads with Lens.config() — e.g. "cube", "version", rows. "access": ["Finance"] limits who can open it in the Lens app; "theme": "fixed" keeps its own look.'}
          </div>
          <div className="flex-1 min-h-0">
            <MonacoEditor
              language="json"
              theme={dark ? 'vs-dark' : 'vs'}
              value={configText}
              onChange={v => { editConfig(v ?? ''); setDirtyPreview(true) }}
              options={{ fixedOverflowWidgets: true, minimap: { enabled: false }, fontSize: 13, automaticLayout: true, tabSize: 2 }}
            />
          </div>
        </div>
        <div className={cn('flex-1 min-h-0', mode !== 'design' && 'hidden')}>
          <MonacoEditor
            language="html"
            theme={dark ? 'vs-dark' : 'vs'}
            value={html}
            onChange={handleEditorChange}
            options={{ fixedOverflowWidgets: true, minimap: { enabled: false }, fontSize: 13, wordWrap: 'on', automaticLayout: true }}
          />
        </div>
        <div className={cn('flex-1 min-h-0', mode === 'design' && 'hidden', mode === 'config' && 'border-l border-border')}>
          <iframe
            key={previewKey}
            ref={iframeRef}
            sandbox="allow-scripts"
            title="Lens preview"
            srcDoc={lensSrcDoc(html, { config: goodConfig })}
            className="w-full h-full bg-white"
          />
        </div>
      </div>
    </div>
  )
}