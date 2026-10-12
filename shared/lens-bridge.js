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
  var ctxCbs = []
  var onMsg = function (ev) {
    var d = ev.data
    if (!d || d.__lensBridge !== 1) return
    if (d.ctx === true) { for (var i = 0; i < ctxCbs.length; i++) ctxCbs[i](d.context || {}); return }
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
    onContext: function (cb) { ctxCbs.push(cb) }
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
function installLensHost(getLensWindow, { getServer, getToken, getLens }) {
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
      if (d.method === 'setContext') {
        writeCtx(d.payload?.patch)
        pushCtx()
        respond(d.id, readCtx())
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
    window.removeEventListener('message', onMessage)
    window.removeEventListener('storage', onStorage)
  }
}

// A tiny, static render of a frame for the preview pane: sandboxed iframe with
// the bridge script prepended. Callers control srcDoc refresh via a key change.
// The Lens app prepends its CSP (connect-src 'none') before calling this.
function lensSrcDoc(html) {
  return `<script>${LENS_BRIDGE_SCRIPT}</script>` + (html ?? '')
}

const api = { LENS_BRIDGE_SCRIPT, installLensHost, lensSrcDoc }

// CommonJS (IDE server + tests) / ESM-interop (IDE client via Vite) / classic
// browser script (Lens app viewer -> window.LensBridge): the same module.
if (typeof module !== 'undefined' && module.exports) module.exports = api
else if (typeof window !== 'undefined') window.LensBridge = api