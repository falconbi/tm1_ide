'use strict'

// ── Shared Lens bridge (ONE copy, used by the IDE and the Lens app) ───────────
// The postMessage contract between a sandboxed Lens frame and its host page.
//
// The frame NEVER holds the token and NEVER talks to the network. It only posts
// { __lensBridge:1, id, chan, method, payload } to its parent; the host page
// (IDE LensEditor or the Lens app viewer) validates the sender, performs the
// call as the signed-in viewer, and posts the result back. The host takes the
// SERVER from its configuration — never from the message.
//
// Usable three ways from the SAME file (no copies):
//   • Node (server):          const { LENS_BRIDGE_SCRIPT } = require('shared/lens-bridge')
//   • IDE client (Vite/ESM):  import { installLensHost } from '@shared/lens-bridge'
//   • Lens app browser page:  <script src="/bridge.js">  →  window.LensBridge.*
// The per-page channel fix (a reply for an earlier page is never taken by this
// one) lives here too — one fix, both apps.

const LENS_BRIDGE_SCRIPT = `
(function () {
  if (window.__fbInstalled) return
  window.__fbInstalled = true
  var seq = 0
  // A private channel per page. The preview frame is reused when its content
  // changes, so a reply meant for an earlier page (same id numbers) must never be
  // taken by this one — only replies echoing this page's channel are accepted.
  var chan = Math.random().toString(36).slice(2) + Date.now().toString(36)
  var ctxCbs = [], liveCbs = []
  var onMsg = function (ev) {
    var d = ev.data
    if (!d || d.__lensBridge !== 1) return
    if (d.ctx === true) { for (var i = 0; i < ctxCbs.length; i++) ctxCbs[i](d.context || {}); return }
    if (d.live === true) { for (var k = 0; k < liveCbs.length; k++) liveCbs[k](d.event || {}); return }
    if (d.chan !== chan) return
    var h = null
    for (var j = 0; j < seqListeners.length; j++) if (seqListeners[j].id === d.id) { h = seqListeners[j]; break }
    if (!h) return
    seqListeners = seqListeners.filter(function (x) { return x !== h })
    if (d.ok) h.resolve(d.result)
    else h.reject(new Error(d.error || 'bridge call failed'))
  }
  var seqListeners = []
  window.addEventListener('message', onMsg)
  window.lensBridge = {
    call: function (method, payload) {
      return new Promise(function (resolve, reject) {
        var id = ++seq
        seqListeners.push({ id: id, resolve: resolve, reject: reject })
        window.parent.postMessage({ __lensBridge: 1, id: id, chan: chan, method: method, payload: payload }, '*')
      })
    },
    getContext: function () { return window.lensBridge.call('getContext', {}) },
    setContext: function (patch) { return window.lensBridge.call('setContext', { patch: patch || {} }) },
    onContext: function (cb) { ctxCbs.push(cb) },
    // Working together (Lens app only): events from others on the same channel.
    onLive: function (cb) { liveCbs.push(cb) }
  }
})()
`

const CTX_KEY = 'tm1-lens-context'

function readCtx() {
  try { return JSON.parse(localStorage.getItem(CTX_KEY) || '{}') } catch { return {} }
}
function writeCtx(patch) {
  const next = { ...readCtx(), ...(patch ?? {}) }
  localStorage.setItem(CTX_KEY, JSON.stringify(next))
  return next
}

// Host side: install on the host page window. `getLensWindow` returns the exact
// iframe's contentWindow (only messages from that source are answered).
// `getServer` is read from the host app's configuration — the IDE uses the tab's
// server, the Lens app uses its settings file; NEVER from the message.
// `getToken` is the IDE's session token (the Lens app has none — its session
// rides in the HttpOnly cookie, so page scripts cannot read it).
// `getLens` names the Lens this host opened — a write is checked against THAT
// saved Lens's declared cubes, never a name taken from the message.
// `live` (Lens app only): relay the working-together stream into the frame.
function installLensHost(getLensWindow, { getServer, getToken, getLens, live = false, openLens }) {
  let stream = null, liveChannel = '', liveConn = ''
  const pushCtx = () => {
    getLensWindow()?.postMessage({ __lensBridge: 1, ctx: true, context: readCtx() }, '*')
  }
  const onStorage = (e) => {
    if (e.key === CTX_KEY) pushCtx()
  }
  const onMessage = async (ev) => {
    const d = ev.data
    if (!d || d.__lensBridge !== 1) return
    if (ev.source !== getLensWindow()) return
    const respond = (id, result, error) => {
      getLensWindow()?.postMessage({ __lensBridge: 1, id, chan: d.chan, ok: !error, result, error }, '*')
    }
    try {
      if (d.method === 'getContext') {
        respond(d.id, readCtx())
        return
      }
      // Open another Lens (an app home page's tiles, a process page's steps).
      // The host decides how: the Lens app navigates, the IDE opens a tab.
      // Only a Lens name crosses — never a URL.
      if (d.method === 'openLens') {
        const name = String(d.payload?.name ?? '')
        if (!/^[a-zA-Z0-9_-]+$/.test(name)) throw new Error('not a Lens name')
        if (!openLens) throw new Error('opening another Lens is not available here')
        openLens(name)
        respond(d.id, { ok: true })
        return
      }
      if (d.method === 'setContext') {
        writeCtx(d.payload?.patch)
        pushCtx()
        respond(d.id, readCtx())
        return
      }
      if (d.method === 'liveJoin' || d.method === 'liveSend' || d.method === 'history') {
        const lens = getLens ? getLens() : null
        if (!live || !lens) throw new Error('working together needs the Lens app')
        const base = `/api/live/${encodeURIComponent(lens)}`
        if (d.method === 'liveJoin') {
          if (stream) stream.close()
          liveChannel = String(d.payload?.channel ?? ''); liveConn = ''
          stream = new EventSource(`${base}?channel=${encodeURIComponent(liveChannel)}`)
          stream.onmessage = (m) => {
            let ev = null
            try { ev = JSON.parse(m.data) } catch { return }
            if (ev.type === 'hello') liveConn = ev.you?.id ?? ''
            getLensWindow()?.postMessage({ __lensBridge: 1, live: true, event: ev }, '*')
          }
          respond(d.id, { channel: liveChannel })
          return
        }
        if (d.method === 'liveSend') {
          if (!liveConn) { respond(d.id, { skipped: true }); return }   // not connected yet
          const res = await fetch(base, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ channel: liveChannel, conn: liveConn, event: d.payload?.event }) })
          const data = await res.json().catch(() => ({}))
          if (!res.ok) throw new Error(data.error || res.statusText)
          respond(d.id, data)
          return
        }
        const res = await fetch(`/api/lens/${encodeURIComponent(lens)}/history?match=${encodeURIComponent(JSON.stringify(d.payload?.match ?? {}))}&limit=${encodeURIComponent(d.payload?.limit ?? 30)}&skip=${encodeURIComponent((d.payload?.skip ?? []).join(','))}`)
        const data = await res.json().catch(() => ({}))
        if (!res.ok) throw new Error(data.error || res.statusText)
        respond(d.id, data)
        return
      }
      const server = getServer()
      const token = getToken ? getToken() : null
      if (!server) throw new Error('no server configured')
      const enc = encodeURIComponent
      const headers = { 'x-ide-token': token ?? '', 'Content-Type': 'application/json' }
      let url, init
      if (d.method === 'execMDX') {
        url = `/api/lens/exec-mdx?server=${enc(server)}`
        init = { method: 'POST', headers, body: JSON.stringify({ mdx: d.payload?.mdx }) }
      } else if (d.method === 'readCell') {
        url = `/api/lens/read-cell?server=${enc(server)}`
        init = { method: 'POST', headers, body: JSON.stringify({ cube: d.payload?.cube, coordinates: d.payload?.coordinates }) }
      } else if (d.method === 'writeCells') {
        const lens = getLens ? getLens() : null
        if (!lens) throw new Error('save the Lens first — changes are checked against the saved Lens')
        url = `/api/lens/write-cells?server=${enc(server)}`
        init = { method: 'POST', headers, body: JSON.stringify({ lens, cube: d.payload?.cube, cells: d.payload?.cells }) }
      } else if (d.method === 'runProcess') {
        const lens = getLens ? getLens() : null
        if (!lens) throw new Error('save the Lens first — processes are checked against the saved Lens')
        url = `/api/lens/run-process?server=${enc(server)}`
        init = { method: 'POST', headers, body: JSON.stringify({ lens, process: d.payload?.process, params: d.payload?.params ?? {} }) }
      } else if (d.method === 'whoami') {
        url = `/api/lens/whoami?server=${enc(server)}`
        init = { method: 'GET', headers }
      } else if (d.method === 'getMeta') {
        url = `/api/lens/meta?server=${enc(server)}${d.payload?.cube ? `&cube=${enc(d.payload.cube)}` : ''}`
        init = { method: 'GET', headers }
      } else {
        throw new Error(`Unknown bridge method: ${d.method}`)
      }
      const res = await fetch(url, init)
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || res.statusText)
      respond(d.id, d.method === 'readCell' ? data.value : data)
    } catch (e) {
      respond(d.id, null, e.message)
    }
  }
  window.addEventListener('message', onMessage)
  window.addEventListener('storage', onStorage)
  return () => {
    if (stream) stream.close()
    window.removeEventListener('message', onMessage)
    window.removeEventListener('storage', onStorage)
  }
}

// A tiny, static render of a frame for the preview pane: sandboxed iframe with
// the bridge script prepended. Callers control srcDoc refresh via a key change.
// The Lens app prepends its CSP (connect-src 'none') before calling this.
// config: the Lens's settings, handed over before any of its code runs —
// read with Lens.config() (or window.__lensConfig without the toolkit).
// theme: the viewer's { mode, palette } — not handed over when the Lens's
// config says theme: 'fixed' (it keeps its own designed look).
function lensSrcDoc(html, { config, theme } = {}) {
  const c = config && typeof config === 'object' ? config : {}
  const cfg = JSON.stringify(c).replace(/</g, '\\u003c')
  const th = theme && c.theme !== 'fixed' ? JSON.stringify({ mode: String(theme.mode || 'system'), palette: String(theme.palette || '') }).replace(/</g, '\\u003c') : 'null'
  return `<script>${LENS_BRIDGE_SCRIPT}\nwindow.__lensConfig = ${cfg};\nwindow.__lensTheme = ${th};</script>` + (html ?? '')
}

const api = { LENS_BRIDGE_SCRIPT, installLensHost, lensSrcDoc }

// CommonJS (IDE server + tests) / ESM-interop (IDE client via Vite) / classic
// browser script (Lens app viewer -> window.LensBridge): the same module.
if (typeof module !== 'undefined' && module.exports) module.exports = api
else if (typeof window !== 'undefined') window.LensBridge = api