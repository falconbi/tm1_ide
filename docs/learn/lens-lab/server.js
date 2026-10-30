'use strict'

// Lens learning lab — no dependencies, two origins, five experiments.
//   node docs/learn/lens-lab/server.js
//   http://localhost:3001
//
// Everything here is deliberately small so you can read it, change it, and
// watch the browser refuse things. The README lists the experiments.

const http = require('http')

const A = 3001
const B = 3002

const page = (title, body) => `<!doctype html><html><head><meta charset="utf-8">
<title>${title}</title>
<style>
  body{font:15px/1.55 system-ui,sans-serif;max-width:860px;margin:36px auto;padding:0 18px;color:#0f172a}
  pre{background:#f1f5f9;border:1px solid #e2e8f0;border-radius:8px;padding:12px;white-space:pre-wrap}
  code{background:#f1f5f9;padding:1px 5px;border-radius:4px}
  a{color:#0f766e} ul{padding-left:20px} .note{color:#475569;font-size:13.5px}
  iframe{width:100%;height:340px;border:1px solid #cbd5e1;border-radius:8px}
</style></head><body>${body}</body></html>`

function send(res, status, body, headers = {}) {
    res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8', ...headers })
    res.end(body)
}
function json(res, status, obj, headers = {}) {
    res.writeHead(status, { 'Content-Type': 'application/json', ...headers })
    res.end(JSON.stringify(obj))
}
function cookies(req) {
    const out = {}
    for (const part of String(req.headers.cookie || '').split(';')) {
        const i = part.indexOf('=')
        if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim())
    }
    return out
}

// ── The frame's script: it tries the things a hostile Lens would try ─────────
const FRAME_SCRIPT = `
<pre id="log"></pre>
<script>
  var log = function (k, v) { document.getElementById('log').textContent += k + ': ' + v + '\\n' }
  ;(async function () {
    try { log('parent.document.title', parent.document.title) }
    catch (e) { log('parent.document.title', 'BLOCKED — ' + e.name) }

    try { log('document.cookie', JSON.stringify(document.cookie)) }
    catch (e) { log('document.cookie', 'BLOCKED — ' + e.name) }

    try { localStorage.setItem('x', '1'); log('localStorage', 'WORKS') }
    catch (e) { log('localStorage', 'BLOCKED — ' + e.name) }

    try {
      var r = await fetch('/api/data')
      log('fetch /api/data', (await r.text()).slice(0, 70))
    } catch (e) { log('fetch /api/data', 'BLOCKED — ' + e.name + ': ' + e.message) }

    try {
      var value = await new Promise(function (resolve, reject) {
        var id = 1
        var t = setTimeout(function () { reject(new Error('timeout')) }, 1500)
        addEventListener('message', function h(ev) {
          if (ev.data && ev.data.__labReply === id) {
            clearTimeout(t); removeEventListener('message', h); resolve(ev.data.value)
          }
        })
        parent.postMessage({ __labBridge: 1, id: id, method: 'getData' }, '*')
      })
      log('bridge getData', value)
    } catch (e) { log('bridge getData', 'FAILED — ' + e.message) }
  })()
<\/script>`

const STRICT_CSP =
    "sandbox allow-scripts; default-src 'none'; script-src 'unsafe-inline'; " +
    "style-src 'unsafe-inline'; img-src data:; connect-src 'none'"

const WEAK_CSP =
    "default-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'"

// ── Origin A ─────────────────────────────────────────────────────────────────
const serverA = http.createServer((req, res) => {
    const url = new URL(req.url, `http://localhost:${A}`)
    const p = url.pathname

    if (p === '/') {
        return send(res, 200, page('Lens lab', `
      <h1>Lens learning lab</h1>
      <p class="note">Origin A is <code>http://localhost:${A}</code>; origin B is
      <code>http://localhost:${B}</code>. Different ports = different origins.</p>
      <h3>Experiments</h3>
      <ul>
        <li><a href="/cookie-demo">1. Cookies, sessions, HttpOnly</a></li>
        <li><a href="http://localhost:${B}/">2. Same-origin policy and CORS</a></li>
        <li><a href="/frame-host">3–5. Sandbox, CSP and postMessage (strict)</a></li>
        <li><a href="/frame-host?weak=1">6. The same frame with the controls removed</a></li>
      </ul>
      <p class="note">Open DevTools → Console for every experiment. The console is the teacher here.</p>`))
    }

    if (p === '/cookie-demo') {
        const user = cookies(req).session
        return send(res, 200, page('Cookies', `
      <h1>Cookies and sessions</h1>
      <p>Set a session cookie as <b>alice</b> or <b>bob</b>:
        <a href="/set-cookie?user=alice">alice</a> ·
        <a href="/set-cookie?user=bob">bob</a> ·
        <a href="/set-cookie?user=">clear</a></p>
      <p>Server sees you as: <b>${user ? user : '(nobody)'}</b>
        — <a href="/whoami">/whoami</a> (the server reads the cookie; the page cannot)</p>
      <p><code>document.cookie</code> on this page:</p>
      <pre id="c">…</pre>
      <script>document.getElementById('c').textContent = JSON.stringify(document.cookie)</script>
      <p class="note">Reload after setting the cookie. The session cookie is HttpOnly, so it never
      appears in <code>document.cookie</code> — but the server still receives it. That is the
      difference between “the page knows” and “the server knows”.</p>`))
    }

    if (p === '/set-cookie') {
        const user = url.searchParams.get('user') || ''
        const cookie = user
            ? `session=${encodeURIComponent(user)}; HttpOnly; SameSite=Strict; Path=/`
            : 'session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0'
        res.writeHead(303, { Location: '/cookie-demo', 'Set-Cookie': cookie })
        return res.end()
    }

    if (p === '/whoami') {
        const user = cookies(req).session
        if (!user) return json(res, 401, { error: 'not signed in' })
        return json(res, 200, { user, note: 'read from the HttpOnly cookie on the server' })
    }

    // No CORS headers: another origin cannot read this.
    if (p === '/api/data') {
        return json(res, 200, { secret: 'only for the signed-in user', value: 42 })
    }

    // Allows exactly origin B on the same host, nothing else. Derived from the
    // request's Host so the lab also works over a LAN IP, without using '*'.
    if (p === '/api/data-cors') {
        const host = String(req.headers.host || `localhost:${A}`).split(':')[0]
        return json(res, 200, { secret: 'allowed for origin B only', value: 42 },
            { 'Access-Control-Allow-Origin': `http://${host}:${B}`, Vary: 'Origin' })
    }

    if (p === '/frame-host') {
        const weak = url.searchParams.get('weak') === '1'
        const iframe = weak
            ? `<iframe id="f" src="/frame-weak"></iframe>`
            : `<iframe id="f" src="/frame" sandbox="allow-scripts"></iframe>`
        return send(res, 200, page(weak ? 'Weak frame' : 'Strict frame', `
      <h1>${weak ? 'The same frame, with the controls removed' : 'A sandboxed frame with no network'}</h1>
      <p class="note">${weak
            ? 'No sandbox attribute, no strict CSP. This is what a Lens would be if it were trusted.'
            : 'sandbox allow-scripts, and a CSP with connect-src none. The frame can only ask through the bridge.'}</p>
      ${iframe}
      <p class="note">Host side: it answers only messages whose <code>event.source</code> is this exact
      frame, and it supplies the data itself — the frame never chooses the server or the user.</p>
      <script>
        var f = document.getElementById('f')
        addEventListener('message', function (ev) {
          var d = ev.data || {}
          if (d.__labBridge !== 1) return
          if (ev.source !== f.contentWindow) return        // <-- the source check
          f.contentWindow.postMessage({ __labReply: d.id, value: 42 }, '*')
        })
      <\/script>`))
    }

    if (p === '/frame') {
        return send(res, 200, page('Frame (strict)', `
      <h1>Inside the frame</h1>${FRAME_SCRIPT}`), { 'Content-Security-Policy': STRICT_CSP })
    }

    if (p === '/frame-weak') {
        return send(res, 200, page('Frame (weak)', `
      <h1>Inside the frame</h1>${FRAME_SCRIPT}`), { 'Content-Security-Policy': WEAK_CSP })
    }

    send(res, 404, page('404', '<h1>Not found</h1>'))
})

// ── Origin B: the "other site" ────────────────────────────────────────────────
const serverB = http.createServer((req, res) => {
    const p = new URL(req.url, `http://localhost:${B}`).pathname
    if (p !== '/') return send(res, 404, page('404', '<h1>Not found</h1>'))

    return send(res, 200, page('Origin B', `
    <h1>Origin B — <code>http://localhost:${B}</code></h1>
    <p>This page tries to read two endpoints on origin A. Only one is allowed.</p>
    <pre id="log"></pre>
    <script>
      var log = function (k, v) { document.getElementById('log').textContent += k + ': ' + v + '\\n' }
      var hostA = 'http://' + location.hostname + ':${A}'
      ;(async function () {
        try {
          var a = await fetch(hostA + '/api/data')
          log('/api/data', 'READ — ' + (await a.text()))
        } catch (e) { log('/api/data', 'BLOCKED — ' + e.message) }

        try {
          var b = await fetch(hostA + '/api/data-cors')
          log('/api/data-cors', 'READ — ' + (await b.text()))
        } catch (e) { log('/api/data-cors', 'BLOCKED — ' + e.message) }
      })()
    <\/script>
    <p class="note">The browser enforces this, not the server. The blocked request may still reach
    the server; the browser simply refuses to let this page read the response. That is why CORS is
    not an access control for data — it protects reads across origins, not the data itself.</p>`))
})

serverA.listen(A, () => console.log(`origin A  http://localhost:${A}`))
serverB.listen(B, () => console.log(`origin B  http://localhost:${B}`))
