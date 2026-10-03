import { useState, useRef, useCallback, useEffect } from 'react'
import MonacoEditor from '@monaco-editor/react'
import { useStore } from '@/store'
import { Sparkles, Save, RefreshCw, Loader2, Eye, Pencil } from 'lucide-react'
import { cn } from '@/lib/utils'
import { lensSrcDoc, installLensHost } from '@/lib/lens-bridge'

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

export default function LensEditor({ tab }) {
  const { dark } = useStore()
  const [name, setName] = useState(tab.name ?? '')
  const [description, setDescription] = useState('')
  const [cube, setCube] = useState(tab.cube ?? '')
  const [cubes, setCubes] = useState([])
  const [html, setHtml] = useState(DEFAULT_LENS)
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
    if (tab.name) {
      fetch(`/api/lenses/${encodeURIComponent(tab.name)}?server=${encodeURIComponent(tab.server)}&_=${Date.now()}`, { headers: { 'x-ide-token': token() } })
        .then(r => r.json())
        .then(d => { if (d.html) setHtml(d.html) })
        .catch(() => {})
    }
  }, [tab.server, tab.name])

  useEffect(() => {
    const off = installLensHost(
      () => iframeRef.current?.contentWindow,
      { getServer: () => tab.server, getToken: token },
    )
    return off
  }, [tab.server])

  useEffect(() => {
    if (!dirtyPreview) return
    clearTimeout(previewTimer.current)
    previewTimer.current = setTimeout(() => { setDirtyPreview(false); setPreviewKey(k => k + 1) }, 600)
    return () => clearTimeout(previewTimer.current)
  }, [html, dirtyPreview])

  const generate = async () => {
    if (!description.trim()) { setMessage({ kind: 'error', text: 'Describe the lens you want first' }); return }
    setGenerating(true)
    setMessage(null)
    try {
      const res = await fetch('/api/lenses/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-ide-token': token() },
        body: JSON.stringify({ server: tab.server, cube: cube || undefined, description }),
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
    setSaving(true)
    setMessage(null)
    setValidation([])
    try {
      const res = await fetch(`/api/lenses/${encodeURIComponent(name.trim())}?server=${encodeURIComponent(tab.server)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-ide-token': token() },
        body: JSON.stringify({ html, description, publish, force }),
      })
      const data = await res.json()
      if (!res.ok) {
        if (Array.isArray(data.validation)) setValidation(data.validation)
        throw new Error(data.error || res.statusText)
      }
      setMessage({ kind: 'ok', text: `Saved "${data.name}" (${data.status})${data.validation?.length ? ` — ${data.validation.length} validation warnings` : ''}` })
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
          value={description}
          onChange={e => setDescription(e.target.value)}
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
        <div className={cn('flex-1 min-h-0', mode === 'preview' && 'hidden')}>
          <MonacoEditor
            language="html"
            theme={dark ? 'vs-dark' : 'vs'}
            value={html}
            onChange={handleEditorChange}
            options={{ fixedOverflowWidgets: true, minimap: { enabled: false }, fontSize: 13, wordWrap: 'on', automaticLayout: true }}
          />
        </div>
        <div className={cn('flex-1 min-h-0', mode === 'design' && 'hidden')}>
          <iframe
            key={previewKey}
            ref={iframeRef}
            sandbox="allow-scripts"
            title="Lens preview"
            srcDoc={lensSrcDoc(html)}
            className="w-full h-full bg-white"
          />
        </div>
      </div>
    </div>
  )
}