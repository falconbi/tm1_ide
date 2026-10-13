'use strict'

// ── Lens app — read-only Lens viewer for business users ───────────────────────
// A separate small server in the same project as the IDE, sharing core/ (TM1
// client, sign-in, model store, Lens store/bridge). Serves ONE TM1 server from
// config/lens-app.json (gitignored; config/lens-app.example.json is the shape).
//
// Read-only only: execMDX / readCell / getMeta — literally no write routes. The
// sign-in is the IDE's per-server login (probeAuthMethod + makeClientWithCredentials):
// users sign in to TM1 AS THEMSELVES, one TM1 session per user, rejected
// passwords are never retried, nothing is stored beyond the TM1 session, and the
// app session lives in an HttpOnly, SameSite=Strict cookie (Secure over HTTPS).
//
// The Lens never talks to the network: it posts bridge messages to this host
// page, which answers ONLY the exact iframe (event.source) and uses the server
// from this app's settings — never from the message (shared/lens-bridge.js).

const path = require('path')
const fs = require('fs')
const http = require('http')
const https = require('https')
const crypto = require('crypto')
const express = require('express')

const { probeAuthMethod, makeClientWithCredentials } = require('./core/adapter_registry')
const lensStore = require('./core/lens_store')
const lensBridge = require('./core/lens_bridge')
const sharedBridge = require('./shared/lens-bridge')
const { logLensWrite, logLensRun } = require('./core/lens_activity_log')
const { createIpLimiter, createFailureGuard } = require('./core/login-rate-limit')

const CONFIG_PATH = path.join(__dirname, 'config', 'lens-app.json')
const EXAMPLE_PATH = path.join(__dirname, 'config', 'lens-app.example.json')
const COOKIE = 'lens_session'
const DEFAULT_IDLE_MINUTES = 30

// ── Settings ──────────────────────────────────────────────────────────────────
function loadConfig({ configPath = process.env.LENS_CONFIG || CONFIG_PATH } = {}) {
    let cfg = null
    try { cfg = JSON.parse(fs.readFileSync(configPath, 'utf8')) } catch (e) {
        try {
            cfg = JSON.parse(fs.readFileSync(EXAMPLE_PATH, 'utf8'))
            console.warn(`⚠  ${configPath} not readable (${e.message}) — using ${EXAMPLE_PATH} defaults.`)
        } catch { throw new Error(`No Lens app settings: create ${configPath} (see ${EXAMPLE_PATH}). ${e.message}`) }
    }
    return {
        server:       String(cfg.server ?? '').trim(),
        port:         Number(cfg.port) || 8090,
        showDrafts:   !!cfg.showDrafts,
        idleMinutes:  Number(cfg.idleMinutes) || DEFAULT_IDLE_MINUTES,
        https:        { enabled: !!cfg.https?.enabled, key: cfg.https?.key ?? '', cert: cfg.https?.cert ?? '' },
        // Processes run as the person when their session ends (sign out or idle
        // timeout) — e.g. hand back the data reservations they took through Lenses.
        endSessionProcesses: Array.isArray(cfg.endSessionProcesses)
            ? cfg.endSessionProcesses.filter(s => s && typeof s.process === 'string')
            : [],
    }
}

// ── Session store — one TM1 session per user ──────────────────────────────────
// web:  sid -> { user (key), display, lastSeen }
// tm1:  user -> { client, state, refs:Set<sid> }   (one TM1 session shared by the
//        user's browser sessions; closed when the last one signs out / times out)
// beforeClose(client, display): runs on the person's TM1 session just before
// it is closed (their last browser session signed out or timed out).
function createSessionStore({ idleMs, beforeClose = null }) {
    const web = new Map()
    const tm1 = new Map()
    const userKey = (server, username) => `${server}::${username}`

    function releaseUser(user, display) {
        const entry = tm1.get(user)
        if (!entry || entry.refs.size) return
        tm1.delete(user)
        const close = () => { try { entry.client?._adapter?.closeSession?.() } catch { /* best effort */ } }
        if (!beforeClose) return close()
        Promise.resolve().then(() => beforeClose(entry.client, display)).catch(() => {}).finally(close)
    }

    return {
        get(sid) { return web.get(sid) },
        expires(sid) { return web.delete(sid) },
        touch(sid) { const s = web.get(sid); if (s) s.lastSeen = Date.now() },
        clientFor(sid) {
            const s = web.get(sid)
            if (!s) return null
            const e = tm1.get(s.user)
            if (!e) { web.delete(sid); return null }
            return e.client
        },
        countRefs(user) { return tm1.get(user)?.refs.size ?? 0 },
        existing(user) { return tm1.get(user) ?? null },
        addWebSession(user, display) {
            const sid = crypto.randomBytes(24).toString('hex')
            web.set(sid, { user, display, lastSeen: Date.now() })
            const e = tm1.get(user)
            if (e) e.refs.add(sid)
            return sid
        },
        adoptTm1Session(user, entry) { tm1.set(user, entry); entry.refs = new Set() },
        dropWebSession(sid) {
            const s = web.get(sid)
            web.delete(sid)
            if (s) { const e = tm1.get(s.user); if (e) { e.refs.delete(sid); releaseUser(s.user, s.display) } }
        },
        sweep(now = Date.now()) {
            const stale = []
            for (const [sid, s] of web.entries()) if (now - s.lastSeen > idleMs) stale.push(sid)
            for (const sid of stale) this.dropWebSession(sid)
            return stale.length
        },
    }
}

// ── Small HTML helpers ────────────────────────────────────────────────────────
const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

const PAGE_CSS = `
  body{font-family:system-ui,sans-serif;margin:0;background:#f8fafc;color:#0f172a}
  header{background:#0f172a;color:#f8fafc;padding:14px 24px;display:flex;align-items:center;gap:12px}
  header .brand{font-weight:600;font-size:15px}
  header .sub{color:#94a3b8;font-size:12px}
  main{max-width:920px;margin:0 auto;padding:24px}
  .card{background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:16px 18px;margin-bottom:12px}
  .card h3{margin:0 0 4px;font-size:16px}
  .card .desc{color:#475569;font-size:13px;margin:0 0 8px}
  .card .meta{color:#94a3b8;font-size:12px}
  .badge{display:inline-block;padding:1px 8px;border-radius:999px;font-size:11px;font-weight:600;margin-right:6px}
  .badge.draft{background:#fef3c7;color:#92400e}
  .badge.published{background:#d1fae5;color:#065f46}
  .btn{display:inline-block;margin-top:10px;border:1px solid #cbd5e1;background:#fff;border-radius:8px;padding:7px 14px;font-size:13px;text-decoration:none;color:#0f172a}
  .btn.primary{background:#0f172a;color:#fff;border-color:#0f172a}
  input{width:100%;box-sizing:border-box;margin:6px 0 12px;border:1px solid #cbd5e1;border-radius:8px;padding:9px 12px;font-size:14px}
  label{font-size:12px;color:#475569}
  .err{color:#b91c1c;font-size:13px;margin:8px 0}
  a{color:#0f172a}
`

// narrow: sign-in; wide: a Lens page — a dashboard gets the whole browser width.
function layout(title, body, { narrow = false, wide = false } = {}) {
    return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)} — Lenses</title><style>${PAGE_CSS}</style></head>
<body><header><span class="brand">Lenses</span><span class="sub">${esc(title)}</span></header>
<main${narrow ? ' style="max-width:420px"' : wide ? ' style="max-width:none;padding:14px 18px"' : ''}>${body}</main></body></html>`
}

// A Lens's place in its folder: a leading number in its title is the step
// ("1 Enter targets" → step 1, "Enter targets"); no title → its name.
function stepOf(l) {
    const t = String(l.title || l.name || '').trim()
    const m = /^(\d+)[.)]?\s+(.+)$/.exec(t)
    return m ? { step: m[1], label: m[2] } : { step: '', label: t }
}

// Folders A→Z (no folder last, as 'Other'); inside each, numbered steps first
// in order, then the rest by title.
function groupLenses(lenses) {
    const by = new Map()
    for (const l of lenses) {
        const f = String(l.folder || '')
        if (!by.has(f)) by.set(f, [])
        by.get(f).push(l)
    }
    const order = (a, b) => {
        const sa = stepOf(a), sb = stepOf(b)
        if (sa.step && sb.step) return Number(sa.step) - Number(sb.step)
        if (sa.step || sb.step) return sa.step ? -1 : 1
        return sa.label.localeCompare(sb.label)
    }
    return [...by.keys()].sort((a, b) => (a === '') - (b === '') || a.localeCompare(b))
        .map(folder => ({ folder, items: by.get(folder).sort(order) }))
}

// Who is signed in, next to Sign out — on every page, so nobody wonders which
// account they are looking through.
function signOutBar(display) {
    return `<div style="display:flex;align-items:center;gap:10px"><span style="font-size:13px;color:#475569">Signed in as <b style="color:#0f172a">${esc(display)}</b></span><form method="post" action="/auth/signout" style="margin:0"><button class="btn" style="margin-top:0">Sign out</button></form></div>`
}

function cookieOptions(cfg) {
    return { httpOnly: true, sameSite: 'strict', secure: !!cfg.https?.enabled, path: '/' }
}

function parseCookies(req) {
    const out = {}
    for (const part of String(req.headers.cookie ?? '').split(';')) {
        const i = part.indexOf('=')
        if (i < 0) continue
        try { out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim()) } catch { /* skip malformed */ }
    }
    return out
}

// Build the app. `deps` let the offline tests swap the TM1-facing pieces.
function createApp({ config = loadConfig(), deps = {} } = {}) {
    const cfg = { ...loadConfig(), ...config }
    const probe     = deps.probeAuthMethod      ?? ((s) => probeAuthMethod(s))
    const signIn    = deps.makeClientWithCredentials ?? ((s, c, st) => makeClientWithCredentials(s, c, st))
    const execMdx   = deps.execMdx  ?? ((client, mdx) => lensBridge.execMDX(client, mdx))
    const readCell  = deps.readCell ?? ((client, cube, coords) => lensBridge.readCell(client, cube, coords))
    const getMeta   = deps.getMeta  ?? ((client, cube) => lensBridge.getMeta(client, cube))
    const writeCells = deps.writeCells ?? ((client, args) => lensBridge.writeCells(client, args))
    const logWrite   = deps.logLensWrite ?? logLensWrite
    const runProcess = deps.runProcess ?? ((client, args) => lensBridge.runProcess(client, args))
    const logRun     = deps.logLensRun ?? logLensRun
    const listLenses = deps.listLenses ?? ((server, opts) => lensStore.listLenses(server, opts))
    const readLens   = deps.readLens   ?? ((server, name, opts) => lensStore.readLens(server, name, opts))
    const supported  = deps.toolkitVersion ?? lensStore.TOOLKIT_VERSION

    if (!cfg.server) throw new Error('config/lens-app.json must set "server" — the one TM1 server this Lens app serves')

    // When someone's session ends, run the configured end-of-session processes
    // as them (each logged) before their TM1 session is closed.
    const endSession = deps.endSession ?? (async (client, display) => {
        for (const step of cfg.endSessionProcesses) {
            const params = Object.entries(step.params ?? {}).map(([Name, Value]) => ({ Name, Value: String(Value) }))
            try {
                const r = await client.executeProcess(step.process, params)
                logRun({ server: cfg.server, app: 'lens', user: display, lens: '(session end)', process: step.process, params: step.params ?? {}, status: r?.ProcessExecuteStatusCode })
            } catch (e) {
                logRun({ server: cfg.server, app: 'lens', user: display, lens: '(session end)', process: step.process, params: step.params ?? {}, status: 'Failed', message: e.response?.data?.error?.message ?? e.message })
            }
        }
    })
    const store = createSessionStore({ idleMs: cfg.idleMinutes * 60_000, beforeClose: cfg.endSessionProcesses.length || deps.endSession ? endSession : null })
    // Sign-in throttles: per address, and at most 2 rejected passwords per username
    // in 15 minutes — TM1 locks an account on the 3rd, so this app can never be
    // what locks a real user out (deps can override for tests).
    const ipLimit = deps.ipLimiter ?? createIpLimiter({ max: 10, windowMs: 15 * 60_000 })
    const failures = deps.failureGuard ?? createFailureGuard({ maxFailures: 2, windowMs: 15 * 60_000 })
    const app = express()
    app.set('case sensitive routing', true)
    app.use(express.json({ limit: '1mb' }))
    app.disable('x-powered-by')

    // Only the exact configured server — a request naming another is refused
    // before anything else, and the message can never choose it.
    function serverGate(req, res, next) {
        const q = req.query?.server
        if (q !== undefined && String(q) !== cfg.server) {
            return res.status(400).json({ error: `server "${q}" does not match this Lens app's configured server (${cfg.server})` })
        }
        next()
    }

    function requireSession(req, res, next) {
        const sid = parseCookies(req)[COOKIE]
        const sess = sid ? store.get(sid) : null
        if (!sess) return res.status(401).json({ error: 'you are not signed in' })
        store.touch(sid)
        const client = store.clientFor(sid)
        if (!client) return res.status(401).json({ error: 'your session expired — sign in again' })
        req.lens = { sid, user: sess.user, display: sess.display, client }
        next()
    }

    const who = req => store.get(parseCookies(req)[COOKIE])?.display ?? ''

    function requireSessionPage(req, res, next) {
        const sid = parseCookies(req)[COOKIE]
        const sess = sid ? store.get(sid) : null
        if (!sess || !store.clientFor(sid)) return res.redirect('/signin')
        next()
    }

    // ── Sign-in ────────────────────────────────────────────────────────────────
    app.get('/signin', (req, res) => {
        const mode = cfg.https?.enabled ? ' (HTTPS)' : ''
        const body = `
  <div class="card">
    <h3>Sign in to ${esc(cfg.server)}</h3>
    <p class="desc" style="font-size:12px;color:#64748b">Your TM1 identity. Connects over HTTP${mode}; nothing is stored beyond your session.</p>
    <form id="f">
      <label>Username</label><input id="username" autocomplete="username" required>
      <label>Password</label><input id="password" type="password" autocomplete="current-password" required>
      <div id="nsWrap" style="display:none"><label>CAM namespace</label><input id="namespace" autocomplete="off"></div>
      <div id="err" class="err"></div>
      <button class="btn primary" type="submit">Sign in</button>
    </form>
  </div>
  <script>
    fetch('/auth/method').then(function (r) { return r.json() }).then(function (m) {
      if (m.method === 'cam') document.getElementById('nsWrap').style.display = 'block'
      var el = document.createElement('p'); el.className = 'desc'; el.style.fontSize = '11px'; el.style.color = '#94a3b8'
      el.textContent = 'Server ' + m.server + ' — ' + (m.method || 'unknown')
      document.getElementById('f').parentNode.insertBefore(el, document.getElementById('f'))
    }).catch(function () {})
    document.getElementById('f').addEventListener('submit', function (ev) {
      ev.preventDefault()
      var err = document.getElementById('err'); err.textContent = ''
      fetch('/auth/signin', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
        username: document.getElementById('username').value,
        password: document.getElementById('password').value,
        namespace: document.getElementById('namespace').value || null
      }) }).then(function (r) { return r.json().then(function (d) { return { r: r, d: d } }) }).then(function (o) {
        if (o.r.ok) { window.location.href = '/' }
        else { err.textContent = o.d.rejected === true ? 'TM1 rejected the login — check your username and password.' : (o.d.error || 'Sign-in failed') }
      }).catch(function () { err.textContent = 'Could not reach the Lens app.' })
    })
  </script>`
        res.send(layout('Sign in', body, { narrow: true }))
    })

    app.get('/auth/method', async (req, res) => {
        try {
            const m = await probe(cfg.server)
            res.json({ server: cfg.server, method: m.method, camNamespace: m.camNamespace ?? null, url: m.url ?? null })
        } catch (e) {
            res.status(502).json({ server: cfg.server, method: 'unreachable', error: e.message })
        }
    })

    app.post('/auth/signin', ipLimit, async (req, res) => {
        const { username, password, namespace } = req.body ?? {}
        if (!username) return res.status(400).json({ error: 'username required' })
        const name = String(username).trim()
        const user = `${cfg.server}::${name}`
        const waitMin = failures.blockedFor(user.toLowerCase())
        if (waitMin) return res.status(429).json({ error: `Too many failed sign-ins for "${name}" — wait ${waitMin} minute${waitMin === 1 ? '' : 's'} before trying again (protects the account from TM1's lock-out).` })
        let method
        try { method = (await probe(cfg.server)).method } catch (e) { return res.status(502).json({ error: `Could not reach "${cfg.server}": ${e.message}` }) }
        if (!['native', 'cam'].includes(method)) {
            return res.status(400).json({ error: `Sign-in method "${method}" on ${cfg.server} is not supported by the Lens app yet` })
        }
        // ALWAYS check the password with TM1 — even when this user already has a
        // session. Only a verified sign-in may share (or start) the TM1 session.
        const state = {}
        let cl
        try { cl = signIn(cfg.server, { username: name, password: password ?? '', namespace: namespace || null }, state) } catch { /* unreachable handled below */ }
        if (!cl) return res.status(400).json({ error: `"${cfg.server}" is not reachable as a direct TM1 server` })
        try { await cl.get('ActiveUser', { '$select': 'Name' }) }
        catch (e) {
            if (e.code === 'TM1_AUTH_REJECTED' || (e.response?.status === 401)) {
                failures.recordFailure(user.toLowerCase())
                return res.status(403).json({ rejected: true, error: `TM1 rejected the login for "${cfg.server}" — check your username and password` })
            }
            return res.status(502).json({ error: e.message })
        }
        failures.clear(user.toLowerCase())
        ipLimit.clear?.(req)
        if (store.existing(user)) {
            // Verified, and the user already has a TM1 session: reuse it and close
            // the one just opened for the check (one TM1 session per user).
            try { cl?._adapter?.closeSession?.() } catch { /* best effort */ }
        } else {
            store.adoptTm1Session(user, { client: cl, state, refs: new Set() })
        }
        const sid = store.addWebSession(user, name)
        res.cookie(COOKIE, sid, cookieOptions(cfg))
        res.json({ ok: true, server: cfg.server, username: name })
    })

    app.post('/auth/signout', (req, res) => {
        const sid = parseCookies(req)[COOKIE]
        if (sid) store.dropWebSession(sid)
        res.clearCookie(COOKIE, cookieOptions(cfg))
        // The page's Sign out button is a form post: send the person back to
        // sign-in. A script asking for JSON gets JSON.
        if (req.accepts(['html', 'json']) === 'html') return res.redirect(303, '/signin')
        res.json({ ok: true })
    })

    // ── Home page ──────────────────────────────────────────────────────────────
    app.get('/favicon.ico', (_req, res) => res.status(204).end())

    app.get('/', requireSessionPage, async (req, res) => {
        try {
            const lens = await listLenses(cfg.server, { client: store.clientFor(parseCookies(req)[COOKIE]) })
            const visible = lens.filter(l => l.status === 'published' || (cfg.showDrafts && l.status === 'draft'))
            // Grouped by business process (folder), steps in order, in people's
            // words (title) — no cube or model names on this page.
            const groups = groupLenses(visible)
            const card = l => {
                const { step, label } = stepOf(l)
                const words = [label, l.description, l.folder].join(' ').toLowerCase()
                return `
      <a class="lcard" href="/lens/${encodeURIComponent(l.name)}" data-words="${esc(words)}">
        ${step ? `<span class="step">${esc(step)}</span>` : ''}
        <span class="lbody"><b>${esc(label)}</b>${l.description ? `<span class="desc">${esc(l.description)}</span>` : ''}
        ${l.status === 'draft' ? '<span class="badge draft">draft</span>' : ''}</span>
      </a>`
            }
            const sections = groups.map(g => `
    <details class="folder" open>
      <summary>${esc(g.folder ? g.folder.split('/').join(' › ') : 'Other')} <span class="count">${g.items.length}</span></summary>
      <div class="lgrid">${g.items.map(card).join('')}</div>
    </details>`).join('\n')
            const body = `
  <style>
    .top{display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;margin-bottom:14px}
    .search{flex:1;min-width:220px;max-width:420px;margin:0}
    details.folder{margin:0 0 14px}
    details.folder summary{cursor:pointer;font-weight:700;font-size:15px;padding:6px 0;list-style:none;display:flex;align-items:center;gap:8px}
    details.folder summary::-webkit-details-marker{display:none}
    details.folder summary:before{content:'▸';color:#94a3b8;transition:transform .15s}
    details.folder[open] summary:before{transform:rotate(90deg)}
    .count{font-size:11px;font-weight:600;color:#64748b;background:#e2e8f0;border-radius:999px;padding:1px 8px}
    .lgrid{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:10px;margin-top:6px}
    .lcard{display:flex;gap:12px;align-items:flex-start;background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:12px 14px;text-decoration:none;color:#0f172a;transition:border-color .15s,box-shadow .15s}
    .lcard:hover{border-color:#0f766e;box-shadow:0 2px 10px rgba(15,118,110,.12)}
    .lcard .step{flex:none;width:26px;height:26px;border-radius:50%;background:#0f766e;color:#fff;font-weight:700;font-size:13px;display:grid;place-items:center}
    .lcard .lbody{display:grid;gap:3px;min-width:0}
    .lcard .desc{margin:0;font-size:12.5px;color:#64748b}
    .lcard .badge{justify-self:start;margin-top:2px}
    .none{color:#64748b;font-size:13px}
  </style>
  <div class="top">
    <h2 style="margin:0">Your workspace</h2>
    <input id="q" class="search" type="search" placeholder="Search…" autocomplete="off">
    ${signOutBar(who(req))}
  </div>
  ${visible.length ? sections : '<p class="none">Nothing here yet' + (cfg.showDrafts ? '' : ' (drafts are hidden)') + '.</p>'}
  <p class="none" id="nomatch" hidden>Nothing matches your search.</p>
  <script>
    (function () {
      var q = document.getElementById('q')
      q.addEventListener('input', function () {
        var t = q.value.trim().toLowerCase(), any = false
        Array.prototype.forEach.call(document.querySelectorAll('details.folder'), function (d) {
          var shown = 0
          Array.prototype.forEach.call(d.querySelectorAll('.lcard'), function (c) {
            var hit = !t || c.getAttribute('data-words').indexOf(t) >= 0
            c.style.display = hit ? '' : 'none'; if (hit) shown++
          })
          d.style.display = shown ? '' : 'none'; if (shown) { any = true; if (t) d.open = true }
        })
        document.getElementById('nomatch').hidden = any || !t
      })
    })()
  </script>`
            res.send(layout('Home', body))
        } catch (e) {
            res.status(500).send(layout('Home', `<p class="err">Could not load Lenses: ${esc(e.message)}</p>`))
        }
    })

    // ── Lens viewer (sandboxed, read-only) ─────────────────────────────────────
    app.get('/lens/:name', requireSessionPage, async (req, res) => {
        try {
            const doc = await readLens(cfg.server, req.params.name, { client: store.clientFor(parseCookies(req)[COOKIE]) })
            const want = Number(doc.toolkitVersion) || 1
            if (want > supported) {
                const body = `
  <div class="card">
    <h3>${esc(doc.name)} can\u2019t open here</h3>
    <p class="desc">This Lens needs toolkit version ${want}; this Lens app supports up to ${supported}.</p>
    <p class="desc" style="font-size:12px">Ask the team to update the Lens app, or open the Lens in the builder (IDE) to see it now.</p>
    <a class="btn" href="/">Back to Lenses</a>
  </div>`
                res.set('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; img-src 'self' data:")
                return res.status(200).send(layout(doc.name, body))
            }
            // The Lens renders in a REAL same-origin frame URL, not srcdoc:
            // srcdoc is blocked by the parent's frame-src (and children inherit
            // the parent's CSP, which must not allow network). This frame document
            // is served with its own strict CSP (connect-src 'none') and stays an
            // opaque origin under the sandbox — same contract, plus it actually
            // renders in every browser.
            const body = `
  <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
    <div><a href="/" style="margin-right:10px">&larr; Lenses</a><span style="font-weight:600">${esc(doc.name)}</span> ${esc(doc.description || '') ? `<span class="desc" style="margin-left:6px">— ${esc(doc.description)}</span>` : ''}</div>
    ${signOutBar(who(req))}
  </div>
  <div class="card" style="padding:0;overflow:hidden">
    <iframe id="lensFrame" sandbox="allow-scripts" title="Lens" style="width:100%;height:calc(100vh - 128px);min-height:480px;border:0;display:block" src="/lens-frame/${encodeURIComponent(doc.name)}"></iframe>
  </div>
  <script src="/bridge.js"></script>
  <script>
    (function () {
      var frame = document.getElementById('lensFrame')
      window.LensBridge.installLensHost(function () { return frame.contentWindow }, {
        getServer: function () { return ${JSON.stringify(cfg.server)} },
        getToken: function () { return null },
        getLens: function () { return ${JSON.stringify(doc.name).replace(/</g, '\\u003c')} }
      })
    })()
  </script>`
            res.set('Content-Security-Policy', "default-src 'none'; script-src 'self' 'unsafe-inline'; style-src 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-src 'self'")
            res.send(layout(doc.name, body, { wide: true }))
        } catch (e) {
            res.status(404).send(layout('Lens', `<p class="err">${esc(e.message)}</p>`))
        }
    })

    // The frame document itself: the Lens HTML with the bridge script prepended,
    // served with its own CSP — no network in the frame (connect-src 'none'),
    // scripts only inline, and the sandbox (no allow-same-origin) keeps it an
    // opaque origin. Same contract as the IDE's preview frame.
    app.get('/lens-frame/:name', requireSession, async (req, res) => {
        try {
            const doc = await readLens(cfg.server, req.params.name, { client: req.lens.client })
            const want = Number(doc.toolkitVersion) || 1
            if (want > supported) {
                res.set('Content-Security-Policy', "sandbox; default-src 'none'; style-src 'unsafe-inline'")
                return res.status(200).send(`<!DOCTYPE html><html><body style="font-family:system-ui;padding:24px"><p style="color:#b91c1c">This Lens needs toolkit version ${want}; this Lens app supports up to ${supported}.</p></body></html>`)
            }
            // The sandboxed frame has an opaque origin, so 'self' can't be relied on:
            // allow exactly this app's toolkit path, nothing else. No network.
            const kit = `${req.protocol}://${req.get('host')}/lens-kit/`
            res.set('Content-Security-Policy', `sandbox allow-scripts; default-src 'none'; script-src 'unsafe-inline' ${kit}; style-src 'unsafe-inline'; img-src data:; connect-src 'none'; font-src 'none'`)
            res.type('html')
            res.send(sharedBridge.lensSrcDoc(doc.html ?? ''))
        } catch (e) { res.status(404).send('Lens not found') }
    })

    // The Lens toolkit (window.Lens): one self-contained bundle built into
    // static/lens-kit/ — served from this app, never from the internet.
    // No long caching: browsers re-check (a cheap 304 when unchanged), so a
    // toolkit update reaches every Lens on its next load.
    app.use('/lens-kit', express.static(path.join(__dirname, 'static', 'lens-kit'), { maxAge: 0, fallthrough: false }))

    // The shared bridge host script, served as a classic <script> (it exposes
    // window.LensBridge when not loaded as a module).
    app.get('/bridge.js', (_req, res) => {
        res.type('application/javascript')
        res.send(fs.readFileSync(path.join(__dirname, 'shared', 'lens-bridge.js'), 'utf8'))
    })

    // ── API (server from settings; runs as the signed-in user) ────────────────
    app.get('/api/lenses', requireSession, async (req, res) => {
        const lens = await listLenses(cfg.server, { client: req.lens.client })
        const visible = lens.filter(l => l.status === 'published' || (cfg.showDrafts && l.status === 'draft'))
        res.json(visible)
    })

    // Static read-only bridge routes FIRST — `/api/lens/meta` must win over the
    // generic `/api/lens/:name` (express routes match in registration order).
    app.post('/api/lens/exec-mdx', requireSession, serverGate, async (req, res) => {
        try { res.json(await execMdx(req.lens.client, req.body?.mdx)) }
        catch (e) { res.status(400).json({ error: e.response?.data?.error?.message ?? e.message }) }
    })

    app.post('/api/lens/read-cell', requireSession, serverGate, async (req, res) => {
        try { res.json({ value: await readCell(req.lens.client, req.body?.cube, req.body?.coordinates) }) }
        catch (e) { res.status(400).json({ error: e.response?.data?.error?.message ?? e.message }) }
    })

    // Write-back: numbers only, into the cubes the SAVED Lens declares, as the
    // signed-in user (TM1 security decides the rest), every save logged.
    app.post('/api/lens/write-cells', requireSession, serverGate, async (req, res) => {
        try {
            const name = req.body?.lens
            if (!name || typeof name !== 'string') throw new Error('lens is required')
            const doc = await readLens(cfg.server, name, { client: req.lens.client })
            if (!(doc.status === 'published' || (cfg.showDrafts && doc.status === 'draft'))) throw new Error(`Lens "${name}" is not available here`)
            const result = await writeCells(req.lens.client, { cube: req.body?.cube, cells: req.body?.cells, allowedCubes: lensBridge.declaredWriteCubes(doc.html) })
            logWrite({ server: cfg.server, app: 'lens', user: req.lens.display, lens: doc.name, cube: req.body.cube, changes: result.changes })
            res.json({ written: result.written })
        } catch (e) {
            res.status(e.conflicts ? 409 : 400).json({ error: e.response?.data?.error?.message ?? e.message, conflicts: e.conflicts })
        }
    })

    // Action buttons: run a process the SAVED Lens declares, as the signed-in
    // user, with parameters checked against the process; every run logged.
    app.post('/api/lens/run-process', requireSession, serverGate, async (req, res) => {
        const name = req.body?.lens, process = req.body?.process, params = req.body?.params ?? {}
        try {
            if (!name || typeof name !== 'string') throw new Error('lens is required')
            const doc = await readLens(cfg.server, name, { client: req.lens.client })
            if (!(doc.status === 'published' || (cfg.showDrafts && doc.status === 'draft'))) throw new Error(`Lens "${name}" is not available here`)
            const result = await runProcess(req.lens.client, { process, params, allowedProcesses: lensBridge.declaredRunProcesses(doc.html), user: req.lens.display })
            logRun({ server: cfg.server, app: 'lens', user: req.lens.display, lens: doc.name, process, params, status: result.status, message: result.message })
            res.json(result)
        } catch (e) {
            if (e.status) logRun({ server: cfg.server, app: 'lens', user: req.lens.display, lens: name, process, params, status: e.status, message: e.message })
            res.status(e.status ? 422 : 400).json({ error: e.response?.data?.error?.message ?? e.message, status: e.status })
        }
    })

    app.get('/api/lens/meta', requireSession, serverGate, async (req, res) => {
        try { res.json(await getMeta(req.lens.client, req.query?.cube)) }
        catch (e) { res.status(400).json({ error: e.response?.data?.error?.message ?? e.message }) }
    })

    app.get('/api/lens/:name', requireSession, async (req, res) => {
        try {
            const doc = await readLens(cfg.server, req.params.name, { client: req.lens.client })
            const want = Number(doc.toolkitVersion) || 1
            if (want > supported) {
                return res.status(417).json({ error: `This Lens needs toolkit version ${want}; this Lens app supports up to ${supported}.`, name: doc.name })
            }
            const { html, ...meta } = doc
            res.json({ html, meta })
        } catch (e) { res.status(404).json({ error: e.message }) }
    })

    // Idle sweep
    const timer = setInterval(() => { store.sweep() }, 60_000)
    timer.unref()

    return { app, store, config: cfg, close() { clearInterval(timer) } }
}

function start(cfg) {
    const { app, close } = createApp({ config: cfg })
    const server = cfg.https?.enabled
        ? https.createServer({ key: fs.readFileSync(cfg.https.key), cert: fs.readFileSync(cfg.https.cert) }, app)
        : http.createServer(app)
    server.listen(cfg.port, () => {
        console.log(`Lens app serving "${cfg.server}" at ${cfg.https?.enabled ? 'https' : 'http'}://localhost:${cfg.port}${cfg.showDrafts ? ' (showDrafts on)' : ''}`)
    })
    return { server, close }
}

if (require.main === module) {
    start(loadConfig())
}

module.exports = { createApp, loadConfig, createSessionStore, start, groupLenses, stepOf }