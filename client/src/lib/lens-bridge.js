// Lens bridge — the postMessage contract between a sandboxed frame and the IDE.
//
// The frame NEVER holds the token and NEVER talks to the network. It only posts
// { __lensBridge, id, method, payload } to its parent; the IDE host page (the
// LensEditor) validates the sender, attaches the token, calls the /api/lens/*
// routes as the viewing user, and posts the result back.
//
// The bridge script below is injected into the frame's document by the host, so
// generated frame code just calls window.lensBridge.call('execMDX', {...}).

export const LENS_BRIDGE_SCRIPT = `
(function () {
  if (window.__fbInstalled) return
  window.__fbInstalled = true
  var seq = 0
  var ctxCbs = []
  var onMsg = function (ev) {
    var d = ev.data
    if (!d || d.__lensBridge !== 1) return
    if (d.ctx === true) { for (var i = 0; i < ctxCbs.length; i++) ctxCbs[i](d.context || {}); return }
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
        window.parent.postMessage({ __lensBridge: 1, id: id, method: method, payload: payload }, '*')
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

// Host side: install on the LensEditor window. `getServer` is read from the tab
// (never from the message). `getToken` reads the IDE session token. Only messages
// whose source is the exact iframe's contentWindow are answered. Context sync:
// lenses on the same origin share a localStorage-backed context, so selecting in
// one lens updates every other lens hosting frame (across IDE tabs and PAW tabs).
export function installLensHost(getLensWindow, { getServer, getToken }) {
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
      getLensWindow()?.postMessage({ __lensBridge: 1, id, ok: !error, result, error }, '*')
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
      const token = getToken()
      if (!server) throw new Error('no server selected')
      const enc = encodeURIComponent
      const headers = { 'x-ide-token': token, 'Content-Type': 'application/json' }
      let url, init
      if (d.method === 'execMDX') {
        url = `/api/lens/exec-mdx?server=${enc(server)}`
        init = { method: 'POST', headers, body: JSON.stringify({ mdx: d.payload?.mdx }) }
      } else if (d.method === 'readCell') {
        url = `/api/lens/read-cell?server=${enc(server)}`
        init = { method: 'POST', headers, body: JSON.stringify({ cube: d.payload?.cube, coordinates: d.payload?.coordinates }) }
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
export function lensSrcDoc(html) {
  return `<script>${LENS_BRIDGE_SCRIPT}</script>` + (html ?? '')
}

export function lensPreviewUrl(server, name) {
  return `/lenses/${encodeURIComponent(server)}/${encodeURIComponent(name)}`
}