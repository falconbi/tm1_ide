import { useState, useRef, useEffect, useCallback } from 'react'
import MonacoEditor from '@monaco-editor/react'
import { useStore } from '@/store'
import { Save, Trash2, Copy, Eye, Pencil, SlidersHorizontal, Loader2, RefreshCw } from 'lucide-react'
import { cn } from '@/lib/utils'
import { lensSrcDoc, installLensHost } from '@shared/lens-bridge'
import { LensTile } from '@/components/LensEditor'

const token = () => localStorage.getItem('tm1-token') ?? ''
const headers = () => ({ 'x-ide-token': token(), 'Content-Type': 'application/json' })

// ── A Viewfinder template: its code, what its settings mean, an example, and
// the Lenses built from it ("used by") — with a live preview using the example
// or any of those Lenses' real settings, so a change is seen on real screens
// before it reaches them. Built-in templates are read-only (copy one to make it
// your own); the model's own templates are edited here and recorded in the
// change set.
export default function TemplateEditor({ tab }) {
  const { dark, openTab } = useStore()
  const [tpl, setTpl] = useState(null)
  const [code, setCode] = useState('')
  const [meta, setMeta] = useState('{}')
  const [mode, setMode] = useState('preview')     // code | settings | preview
  const [previewWith, setPreviewWith] = useState('')   // '' = the example, else a Lens name
  const [previewConfig, setPreviewConfig] = useState({})
  const [message, setMessage] = useState(null)
  const [busy, setBusy] = useState(false)
  const iframeRef = useRef(null)
  const [previewKey, setPreviewKey] = useState(0)

  const load = useCallback(() => {
    fetch(`/api/viewfinder?server=${encodeURIComponent(tab.server)}&_=${Date.now()}`, { headers: headers() })
      .then(r => r.json())
      .then(list => {
        const t = Array.isArray(list) ? list.find(x => x.name === tab.name) : null
        if (!t) { setMessage({ kind: 'error', text: `Template "${tab.name}" not found on ${tab.server}` }); return }
        setTpl(t)
        setCode(t.html ?? '')
        setMeta(JSON.stringify({ title: t.title, description: t.description, icon: t.icon, color: t.color, settings: t.settings ?? {}, example: t.example ?? {} }, null, 2) + '\n')
        setPreviewConfig(t.example ?? {})
      })
      .catch(e => setMessage({ kind: 'error', text: e.message }))
  }, [tab.server, tab.name])
  useEffect(() => { load() }, [load])

  useEffect(() => installLensHost(() => iframeRef.current?.contentWindow, { getServer: () => tab.server, getToken: token, getLens: () => previewWith || null }), [tab.server, previewWith])

  // Preview with the example, or with a real Lens's settings.
  useEffect(() => {
    if (!tpl) return
    if (!previewWith) { setPreviewConfig(tpl.example ?? {}); setPreviewKey(k => k + 1); return }
    fetch(`/api/lenses/${encodeURIComponent(previewWith)}?server=${encodeURIComponent(tab.server)}&_=${Date.now()}`, { headers: headers() })
      .then(r => r.json()).then(d => { setPreviewConfig(d.meta?.config ?? {}); setPreviewKey(k => k + 1) }).catch(() => {})
  }, [previewWith, tpl, tab.server])

  const builtIn = tpl?.source === 'built-in'
  const parsedMeta = (() => { try { return JSON.parse(meta) } catch { return null } })()

  const save = async (asName) => {
    if (!parsedMeta) { setMessage({ kind: 'error', text: 'Fix the settings JSON first' }); setMode('settings'); return }
    setBusy(true); setMessage(null)
    try {
      const name = asName || tab.name
      const r = await fetch(`/api/viewfinder/${encodeURIComponent(name)}?server=${encodeURIComponent(tab.server)}`, { method: 'POST', headers: headers(), body: JSON.stringify({ ...parsedMeta, html: code }) })
      const d = await r.json()
      if (!r.ok) throw new Error(d.error || r.statusText)
      window.dispatchEvent(new CustomEvent('tm1-viewfinder-changed', { detail: { server: tab.server } }))
      if (asName) openTab({ id: `viewfinder:${tab.server}:${asName}`, type: 'viewfinder', label: d.title || asName, server: tab.server, name: asName })
      else { setMessage({ kind: 'ok', text: `Saved "${d.title}" (version ${d.version})${tpl?.usedBy?.length ? ` — ${tpl.usedBy.length} Lens${tpl.usedBy.length > 1 ? 'es' : ''} use it and get the change` : ''}${d.validation?.length ? ` — ${d.validation.length} validation warnings` : ''}` }); load() }
    } catch (e) { setMessage({ kind: 'error', text: e.message }) } finally { setBusy(false) }
  }
  // The model holds its own copy of a built-in template (it travels with the
  // model); a newer built-in reaches it only through this deliberate update.
  const updateFromBuiltIn = async () => {
    const n = tpl?.usedBy?.length ?? 0
    if (!window.confirm(`Push the new version of "${tpl?.title}" to the ${n} Lens${n === 1 ? '' : 'es'} using it on ${tab.server}? The change is recorded in the change set and reaches PROD through a release.`)) return
    setBusy(true); setMessage(null)
    try {
      const r = await fetch(`/api/viewfinder/${encodeURIComponent(tab.name)}/update-from-built-in?server=${encodeURIComponent(tab.server)}`, { method: 'POST', headers: headers() })
      const d = await r.json()
      if (!r.ok) throw new Error(d.error || r.statusText)
      window.dispatchEvent(new CustomEvent('tm1-viewfinder-changed', { detail: { server: tab.server } }))
      setMessage({ kind: 'ok', text: `Update pushed to the Lenses using this template.` }); load()
    } catch (e) { setMessage({ kind: 'error', text: e.message }) } finally { setBusy(false) }
  }
  const copyAsOwn = () => {
    const name = window.prompt('Name for the new template (lower-case letters, digits and -):', `${tab.name}-custom`)
    if (name) save(name.trim())
  }
  const remove = async () => {
    if (!window.confirm(`Delete the template "${tpl?.title}" from ${tab.server}?`)) return
    const r = await fetch(`/api/viewfinder/${encodeURIComponent(tab.name)}?server=${encodeURIComponent(tab.server)}`, { method: 'DELETE', headers: headers() })
    const d = await r.json().catch(() => ({}))
    if (!r.ok) { setMessage({ kind: 'error', text: d.error || r.statusText }); return }
    window.dispatchEvent(new CustomEvent('tm1-viewfinder-changed', { detail: { server: tab.server } }))
    setMessage({ kind: 'ok', text: 'Deleted.' })
  }

  if (!tpl) return <div className="p-4 text-sm text-muted-foreground">{message?.text ?? 'Loading…'}</div>
  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-2">
        <LensTile icon={tpl.icon} color={tpl.color} size={26} />
        <div className="min-w-0">
          <div className="text-sm font-semibold">{tpl.title}</div>
          <div className="truncate text-xs text-muted-foreground">{tpl.description}</div>
        </div>
        <div className="ml-auto flex rounded border border-border">
          {[['code', Pencil, 'Code'], ['settings', SlidersHorizontal, 'Settings'], ['preview', Eye, 'Preview']].map(([m, Icon, l]) => (
            <button key={m} onClick={() => setMode(m)} className={cn('inline-flex items-center gap-1 px-2.5 py-1.5 text-sm', mode === m && 'bg-primary text-primary-foreground')}><Icon className="h-3.5 w-3.5" /> {l}</button>
          ))}
        </div>
        {builtIn && tpl.inModel && tpl.newerBuiltIn && (
          <button onClick={updateFromBuiltIn} disabled={busy} className="inline-flex items-center gap-1.5 rounded border border-amber-400 px-3 py-1.5 text-sm text-amber-700 hover:bg-amber-50 disabled:opacity-50" title="A newer version of this template is available"><RefreshCw className="h-4 w-4" /> Push update to the {tpl.usedBy?.length ?? 0} Lens{tpl.usedBy?.length === 1 ? '' : 'es'} using this template</button>
        )}
        {builtIn
          ? <button onClick={copyAsOwn} className="inline-flex items-center gap-1.5 rounded border border-border px-3 py-1.5 text-sm hover:bg-accent" title="Make a new template from this one, with a new name, that you can edit"><Copy className="h-4 w-4" /> Duplicate and edit</button>
          : <>
              <button onClick={() => save()} disabled={busy} className="inline-flex items-center gap-1.5 rounded bg-primary px-3 py-1.5 text-sm text-primary-foreground disabled:opacity-50">{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Save</button>
              <button onClick={remove} disabled={busy || tpl.usedBy?.length > 0} className="inline-flex items-center gap-1.5 rounded border border-border px-2 py-1.5 text-sm hover:bg-accent disabled:opacity-40" title={tpl.usedBy?.length ? 'Still used — point those Lenses elsewhere first' : 'Delete this template'}><Trash2 className="h-4 w-4" /></button>
            </>}
      </div>
      <div className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-1.5 text-xs">
        <span className="text-muted-foreground">Used by:</span>
        {tpl.usedBy?.length
          ? tpl.usedBy.map(l => <button key={l.name} onClick={() => openTab({ id: `lens:${tab.server}:${l.name}`, type: 'lens', label: l.name, server: tab.server, name: l.name })} className="rounded border border-border px-1.5 py-0.5 hover:bg-accent">{l.title}</button>)
          : <span className="italic text-muted-foreground">no Lenses yet</span>}
        {mode === 'preview' && (
          <label className="ml-auto flex items-center gap-1.5 text-muted-foreground">Preview with
            <select value={previewWith} onChange={e => setPreviewWith(e.target.value)} className="rounded border border-border bg-background px-1.5 py-0.5 text-xs text-foreground">
              <option value="">the example settings</option>
              {tpl.usedBy?.map(l => <option key={l.name} value={l.name}>{l.title}'s settings</option>)}
            </select>
          </label>
        )}
      </div>
      {message && <div className={cn('px-3 py-1.5 text-xs border-b', message.kind === 'error' ? 'text-red-600 border-red-200 bg-red-50' : 'text-emerald-700 border-emerald-200 bg-emerald-50')}>{message.text}</div>}
      <div className="flex-1 min-h-0">
        {mode === 'code' && (
          <MonacoEditor language="html" theme={dark ? 'vs-dark' : 'vs'} value={code} onChange={v => setCode(v ?? '')}
            options={{ fixedOverflowWidgets: true, minimap: { enabled: false }, fontSize: 13, wordWrap: 'on', automaticLayout: true, readOnly: builtIn }} />
        )}
        {mode === 'settings' && (
          <MonacoEditor language="json" theme={dark ? 'vs-dark' : 'vs'} value={meta} onChange={v => setMeta(v ?? '')}
            options={{ fixedOverflowWidgets: true, minimap: { enabled: false }, fontSize: 13, automaticLayout: true, tabSize: 2, readOnly: builtIn }} />
        )}
        {mode === 'preview' && (
          <iframe key={previewKey} ref={iframeRef} sandbox="allow-scripts" title="Template preview" className="w-full h-full bg-white"
            srcDoc={lensSrcDoc(code, { config: previewConfig, theme: { mode: dark ? 'dark' : 'light', palette: 'teal' } })} />
        )}
      </div>
    </div>
  )
}
