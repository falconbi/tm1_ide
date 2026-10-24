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
const { logLensWrite, logLensRun, logLensNote, readLensActivity } = require('./core/lens_activity_log')
const { createLiveHub } = require('./core/lens_live')
const { readPrefs, savePrefs, themeCss } = require('./core/lens_prefs')
const THEMES = require('./shared/lens-themes.json')
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

// The Lens app's own pages follow each person's theme: the colours arrive as
// CSS variables (core/lens_prefs.js themeCss) ahead of this.
const PAGE_CSS = `
  body{font-family:system-ui,sans-serif;margin:0;background:var(--app-bg);color:var(--app-ink)}
  header{height:52px;box-sizing:border-box;background:var(--app-panel);color:var(--app-ink);padding:0 16px;display:flex;align-items:center;gap:14px;border-bottom:1px solid var(--app-rule);position:relative;z-index:10}
  header .hl{display:flex;align-items:center;gap:10px;flex:none}
  header .hm{flex:1;display:flex;justify-content:center;min-width:0}
  header .hr{flex:none}
  header .brand{font-weight:700;font-size:15px;letter-spacing:-.01em}
  header a.back{color:var(--app-soft);text-decoration:none;font-size:13.5px;padding:6px 10px;border-radius:8px}
  header a.back:hover{background:var(--app-bg);color:var(--app-ink)}
  header .search{width:100%;max-width:420px;margin:0;padding:7px 12px;font-size:13.5px}
  main{max-width:920px;margin:0 auto;padding:24px}
  main.full{max-width:none;padding:0}
  .card{background:var(--app-panel);border:1px solid var(--app-rule);border-radius:12px;padding:16px 18px;margin-bottom:12px}
  .card h3{margin:0 0 4px;font-size:16px}
  .card .desc{color:var(--app-soft);font-size:13px;margin:0 0 8px}
  .card .meta{color:var(--app-faint);font-size:12px}
  .badge{display:inline-block;padding:1px 8px;border-radius:999px;font-size:11px;font-weight:600;margin-right:6px}
  .badge.draft{background:#fef3c7;color:#92400e}
  .badge.published{background:#d1fae5;color:#065f46}
  .btn{display:inline-block;margin-top:10px;border:1px solid var(--app-rule);background:var(--app-panel);border-radius:8px;padding:7px 14px;font-size:13px;text-decoration:none;color:var(--app-ink);cursor:pointer}
  .btn.primary{background:var(--app-accent);color:#fff;border-color:var(--app-accent)}
  input,select{box-sizing:border-box;border:1px solid var(--app-rule);border-radius:8px;padding:9px 12px;font-size:14px;background:var(--app-panel);color:var(--app-ink)}
  input{width:100%;margin:6px 0 12px}
  label{font-size:12px;color:var(--app-soft)}
  .err{color:#b91c1c;font-size:13px;margin:8px 0}
  a{color:var(--app-ink)}
  details.acct{position:relative}
  details.acct summary{list-style:none;cursor:pointer;display:flex;align-items:center;gap:8px;padding:3px 10px 3px 3px;border-radius:999px;border:1px solid var(--app-rule);background:var(--app-panel)}
  details.acct summary::-webkit-details-marker{display:none}
  details.acct .av{width:28px;height:28px;border-radius:50%;display:grid;place-items:center;background:var(--app-accent);color:#fff;font-size:11.5px;font-weight:700}
  details.acct .nm{font-size:13px;color:var(--app-ink)}
  details.acct .pop{position:absolute;right:0;top:calc(100% + 8px);z-index:30;width:240px;padding:12px;border-radius:12px;border:1px solid var(--app-rule);background:var(--app-panel);box-shadow:0 12px 32px rgba(0,0,0,.18)}
  details.acct .who{font-size:12.5px;color:var(--app-soft);margin-bottom:10px} details.acct .who b{color:var(--app-ink)}
  details.acct .lbl{font-size:10.5px;letter-spacing:.12em;text-transform:uppercase;color:var(--app-faint);margin-bottom:6px}
  details.acct .seg{display:flex;border:1px solid var(--app-rule);border-radius:8px;overflow:hidden}
  details.acct .seg button{flex:1;border:0;background:transparent;color:var(--app-soft);font:inherit;font-size:12.5px;padding:6px 0;cursor:pointer}
  details.acct .seg button.on{background:var(--app-accent);color:#fff;font-weight:600}
  details.acct .sws{display:flex;gap:8px;margin-top:10px;flex-wrap:wrap}
  details.acct .sw{width:26px;height:26px;border-radius:50%;border:2px solid var(--app-rule);cursor:pointer;padding:0}
  details.acct .sw.on{border-color:var(--app-ink);box-shadow:0 0 0 2px var(--app-panel) inset}
  details.acct .palname{font-size:12px;color:var(--app-faint);margin-top:6px}
`

// narrow: sign-in; wide: a Lens page — a dashboard gets the whole browser width.
// One slim bar on every page — left (brand or ← Workspace), middle (e.g.
// search), right (the account button) — and nothing stacked under it: a Lens
// carries its own title. full: the Lens fills everything below the bar.
function layout(title, body, { narrow = false, full = false, theme, left, middle = '', right = '' } = {}) {
    return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)} — Lenses</title><style>${themeCss(theme)}${PAGE_CSS}</style></head>
<body><header><div class="hl">${left ?? '<span class="brand">Lenses</span>'}</div><div class="hm">${middle}</div><div class="hr">${right}</div></header>
<main${narrow ? ' style="max-width:420px"' : full ? ' class="full"' : ''}>${body}</main></body></html>`
}

// ── Lens tiles: an icon on a colour, or the Lens's own image ──────────────────
const LENS_ICONS = require('./shared/lens-icons.json')
const TILE_COLORS = ['#0f766e', '#2563eb', '#7c3aed', '#c2410c', '#be123c', '#0e7490', '#4d7c0f', '#a16207']
const svgOf = (name, stroke = '#fff') => `<svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="${stroke}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${
    (LENS_ICONS[name] ?? []).map(([tag, attrs]) => `<${tag} ${Object.entries(attrs).map(([k, v]) => `${k}="${esc(v)}"`).join(' ')}/>`).join('')}</svg>`
// No icon chosen: guess from what the Lens is for.
function defaultIcon(l) {
    const w = `${l.title ?? ''} ${l.name ?? ''} ${l.description ?? ''}`.toLowerCase()
    return /approv|review|sign.?off/.test(w) ? 'circle-check'
        : /enter|input|form|target/.test(w) ? 'pencil-line'
        : /flow|ownership|network|process/.test(w) ? 'workflow'
        : /dashboard|centre|center|p&l|pnl|report|kpi/.test(w) ? 'chart-column'
        : /demo|example|toolkit|building/.test(w) ? 'sparkles' : 'layers'
}
function tileOf(l) {
    if (l.image) return `<span class="tile"><img src="${esc(l.image)}" alt=""></span>`
    let h = 0
    for (const ch of String(l.name)) h = (h * 31 + ch.charCodeAt(0)) >>> 0
    const color = l.color || TILE_COLORS[h % TILE_COLORS.length]
    return `<span class="tile" style="background:linear-gradient(135deg, ${esc(color)}, ${esc(color)}bb)">${svgOf(l.icon && LENS_ICONS[l.icon] ? l.icon : defaultIcon(l))}</span>`
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

// Who is signed in — one small account button (initials + name). Clicking it
// opens a panel with Appearance (light / dark / match my computer and the
// colour themes, remembered for the login) and Sign out. Minimal on purpose.
function signOutBar(display, prefs = { mode: 'system', palette: THEMES.default }) {
    const initials = String(display || '?').replace(/[^A-Za-z0-9]+/g, ' ').trim().split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()
    const modeBtn = (v, l) => `<button type="button" data-mode="${v}" class="${prefs.mode === v ? 'on' : ''}">${l}</button>`
    const swatch = ([k, t]) => {
        const c = Object.assign({}, THEMES.base.light, t.light)
        return `<button type="button" data-pal="${esc(k)}" title="${esc(t.label)}" class="sw${prefs.palette === k ? ' on' : ''}" style="background:linear-gradient(135deg, ${esc(c.accent)} 50%, ${esc(c.bg)} 50%)"></button>`
    }
    return `<details class="acct"><summary title="Your account and appearance"><span class="av">${esc(initials)}</span><span class="nm">${esc(display)}</span></summary>
  <div class="pop">
    <div class="who">Signed in as <b>${esc(display)}</b></div>
    <div class="lbl">Appearance</div>
    <div class="seg">${modeBtn('system', 'Auto')}${modeBtn('light', 'Light')}${modeBtn('dark', 'Dark')}</div>
    <div class="sws">${Object.entries(THEMES.themes).map(swatch).join('')}</div>
    <div class="palname">${esc((THEMES.themes[prefs.palette] ?? THEMES.themes[THEMES.default]).label)}</div>
    <form method="post" action="/auth/signout" style="margin:10px 0 0"><button class="btn" style="margin:0;width:100%">Sign out</button></form>
  </div></details>
  <script>(function () {
    var box = document.querySelector('details.acct'), cur = ${JSON.stringify({ mode: prefs.mode, palette: prefs.palette }).replace(/</g, '\\u003c')}
    function save(patch) {
      for (var k in patch) cur[k] = patch[k]
      fetch('/api/prefs', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(cur) }).then(function () { location.reload() })
    }
    box.querySelectorAll('[data-mode]').forEach(function (b) { b.onclick = function () { save({ mode: b.getAttribute('data-mode') }) } })
    box.querySelectorAll('[data-pal]').forEach(function (b) { b.onclick = function () { save({ palette: b.getAttribute('data-pal') }) } })
    document.addEventListener('click', function (e) { if (box.open && !box.contains(e.target)) box.open = false })
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') box.open = false })
  })()</script>`
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
    const elementTree = deps.elementTree ?? ((client, dim, hier) => lensBridge.elementTree(client, dim, hier))
    const hierarchies = deps.hierarchies ?? ((client, dim) => lensBridge.hierarchies(client, dim))
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
    // Each person's theme (and later other preferences), remembered per login.
    const prefsFile = deps.prefsFile
    const prefsOf = req => readPrefs(cfg.server, who(req) || req.lens?.display || '', prefsFile)

    // ── Lens access: config.access lists the TM1 groups that may open a Lens.
    // The person's groups are asked of TM1 as them and kept for 5 minutes; if
    // TM1 can't say, they count as in no group (restricted Lenses stay shut).
    const groupCache = new Map()
    const fetchGroups = deps.groupsOf ?? (async client => {
        const d = await client.get('ActiveUser', { '$expand': 'Groups($select=Name)' })
        return (d?.Groups ?? []).map(g => g.Name)
    })
    async function groupsFor(sid) {
        const sess = sid ? store.get(sid) : null, client = sid ? store.clientFor(sid) : null
        if (!sess || !client) return []
        const hit = groupCache.get(sess.user)
        if (hit && Date.now() - hit.at < 5 * 60_000) return hit.groups
        let groups = []
        try { groups = await fetchGroups(client) } catch { /* none */ }
        groupCache.set(sess.user, { groups, at: Date.now() })
        return groups
    }
    async function openable(sid, doc) {
        if (!lensStore.canOpenLens(doc, await groupsFor(sid))) {
            const e = new Error(`Lens "${doc.name}" is not available to you`)
            e.status = 403
            throw e
        }
        return doc
    }

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
            const sid = parseCookies(req)[COOKIE]
            const lens = await listLenses(cfg.server, { client: store.clientFor(sid) })
            const myGroups = await groupsFor(sid)
            const visible = lens.filter(l => (l.status === 'published' || (cfg.showDrafts && l.status === 'draft')) && lensStore.canOpenLens(l, myGroups))
            // Grouped by business process (folder), steps in order, in people's
            // words (title) — no cube or model names on this page.
            const groups = groupLenses(visible)
            const card = l => {
                const { step, label } = stepOf(l)
                const words = [label, l.description, l.folder].join(' ').toLowerCase()
                return `
      <a class="lcard" href="/lens/${encodeURIComponent(l.name)}" data-words="${esc(words)}">
        ${tileOf(l)}
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
    .search{flex:1;min-width:220px;max-width:420px;margin:0}
    details.folder{margin:0 0 14px}
    details.folder summary{cursor:pointer;font-weight:700;font-size:15px;padding:6px 0;list-style:none;display:flex;align-items:center;gap:8px}
    details.folder summary::-webkit-details-marker{display:none}
    details.folder summary:before{content:'▸';color:var(--app-faint);transition:transform .15s}
    details.folder[open] summary:before{transform:rotate(90deg)}
    .count{font-size:11px;font-weight:600;color:var(--app-faint);background:var(--app-rule);border-radius:999px;padding:1px 8px}
    .lgrid{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:10px;margin-top:6px}
    .lcard{display:flex;gap:12px;align-items:flex-start;background:var(--app-panel);border:1px solid var(--app-rule);border-radius:12px;padding:12px 14px;text-decoration:none;color:var(--app-ink);transition:border-color .15s,box-shadow .15s}
    .lcard:hover{border-color:var(--app-accent);box-shadow:0 2px 10px rgba(15,118,110,.12)}
    .lcard{align-items:center;position:relative}
    .lcard .tile{flex:none;width:52px;height:52px;border-radius:14px;display:grid;place-items:center;overflow:hidden;box-shadow:0 4px 14px rgba(15,23,42,.14)}
    .lcard .tile img{width:100%;height:100%;object-fit:cover}
    .lcard .step{position:absolute;top:8px;left:8px;width:20px;height:20px;border-radius:50%;background:var(--app-ink);color:var(--app-panel);font-weight:700;font-size:11px;display:grid;place-items:center;border:2px solid var(--app-panel)}
    .lcard .lbody{display:grid;gap:3px;min-width:0}
    .lcard .desc{margin:0;font-size:12.5px;color:var(--app-faint)}
    .lcard .badge{justify-self:start;margin-top:2px}
    .none{color:var(--app-faint);font-size:13px}
    .peek{position:fixed;z-index:20;width:560px;height:350px;border-radius:14px;overflow:hidden;background:var(--app-panel);border:1px solid var(--app-rule);box-shadow:0 18px 50px rgba(15,23,42,.28);pointer-events:none;opacity:0;transform:translateY(6px) scale(.98);transition:opacity .18s,transform .18s}
    .peek.on{opacity:1;transform:none}
    .peek iframe{width:1120px;height:700px;border:0;transform:scale(.5);transform-origin:0 0;display:none}
    .peek .wait{position:absolute;inset:0;display:grid;place-items:center;color:var(--app-faint);font-size:12px;letter-spacing:.12em;text-transform:uppercase}
    @media (hover:none),(max-width:900px){.peek{display:none}}
  </style>
  ${visible.length ? sections : '<p class="none">Nothing here yet' + (cfg.showDrafts ? '' : ' (drafts are hidden)') + '.</p>'}
  <p class="none" id="nomatch" hidden>Nothing matches your search.</p>
  <div class="peek" id="peek"><div class="wait" id="peekWait">Loading preview…</div></div>
  <script src="/bridge.js"></script>
  <script>
    // Hover a Lens for half a second: a live, scaled-down preview of it, with
    // your own data (the same sandboxed frame and checks as opening it). One
    // preview loads at a time; a preview once loaded is kept.
    (function () {
      var peek = document.getElementById('peek'), wait = document.getElementById('peekWait')
      var frames = {}, timer = null, current = null
      function frameFor(name) {
        if (frames[name]) return frames[name]
        var f = document.createElement('iframe')
        f.setAttribute('sandbox', 'allow-scripts')
        f.setAttribute('tabindex', '-1')
        f.title = 'Preview'
        f.onload = function () { if (current === name) { wait.style.display = 'none'; f.style.display = 'block' } f.dataset.loaded = '1' }
        f.src = '/lens-frame/' + encodeURIComponent(name)
        window.LensBridge.installLensHost(function () { return f.contentWindow }, {
          getServer: function () { return ${JSON.stringify(cfg.server).replace(/</g, '\\u003c')} },
          getToken: function () { return null },
          getLens: function () { return name },
          live: false
        })
        peek.appendChild(f)
        frames[name] = f
        return f
      }
      function show(card) {
        var name = decodeURIComponent(card.getAttribute('href').slice('/lens/'.length))
        current = name
        Object.keys(frames).forEach(function (k) { frames[k].style.display = 'none' })
        var f = frameFor(name)
        wait.style.display = f.dataset.loaded ? 'none' : 'grid'
        if (f.dataset.loaded) f.style.display = 'block'
        var r = card.getBoundingClientRect(), w = 560, h = 350
        var left = r.right + 12 + w > window.innerWidth ? Math.max(8, r.left - w - 12) : r.right + 12
        var top = Math.min(Math.max(8, r.top - 40), window.innerHeight - h - 8)
        peek.style.left = left + 'px'; peek.style.top = top + 'px'
        peek.classList.add('on')
      }
      function hide() { clearTimeout(timer); current = null; peek.classList.remove('on') }
      Array.prototype.forEach.call(document.querySelectorAll('.lcard'), function (card) {
        card.addEventListener('mouseenter', function () { clearTimeout(timer); timer = setTimeout(function () { show(card) }, 450) })
        card.addEventListener('mouseleave', hide)
      })
      window.addEventListener('scroll', hide, { passive: true })
    })()
  </script>
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
            res.send(layout('Workspace', body, { theme: prefsOf(req),
                middle: '<input id="q" class="search" type="search" placeholder="Search Lenses…" autocomplete="off">',
                right: signOutBar(who(req), prefsOf(req)) }))
        } catch (e) {
            res.status(500).send(layout('Home', `<p class="err">Could not load Lenses: ${esc(e.message)}</p>`))
        }
    })

    // ── Lens viewer (sandboxed, read-only) ─────────────────────────────────────
    app.get('/lens/:name', requireSessionPage, async (req, res) => {
        try {
            const doc = await openable(parseCookies(req)[COOKIE], await readLens(cfg.server, req.params.name, { client: store.clientFor(parseCookies(req)[COOKIE]) }))
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
  <iframe id="lensFrame" sandbox="allow-scripts allow-modals" title="${esc(stepOf(doc).label)}" style="width:100%;height:calc(100vh - 52px);border:0;display:block" src="/lens-frame/${encodeURIComponent(doc.name)}"></iframe>
  <script src="/bridge.js"></script>
  <script>
    (function () {
      var frame = document.getElementById('lensFrame')
      window.LensBridge.installLensHost(function () { return frame.contentWindow }, {
        getServer: function () { return ${JSON.stringify(cfg.server)} },
        getToken: function () { return null },
        getLens: function () { return ${JSON.stringify(doc.name).replace(/</g, '\\u003c')} },
        openLens: function (n) { window.location.assign('/lens/' + encodeURIComponent(n)) },
        live: true
      })
    })()
  </script>`
            res.set('Content-Security-Policy', "default-src 'none'; script-src 'self' 'unsafe-inline'; style-src 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-src 'self'")
            res.send(layout(stepOf(doc).label, body, { full: true, theme: prefsOf(req),
                left: '<a class="back" href="/" title="Back to your workspace">&larr; Workspace</a>',
                right: signOutBar(who(req), prefsOf(req)) }))
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
            const doc = await openable(req.lens.sid, await readLens(cfg.server, req.params.name, { client: req.lens.client }))
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
            res.send(sharedBridge.lensSrcDoc(doc.html ?? '', { config: doc.config, theme: prefsOf(req) }))
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
    // Who the person is and their TM1 groups — so a Lens can show, say, Approve
    // only to approvers (the processes still enforce it either way).
    app.get('/api/lens/whoami', requireSession, async (req, res) => {
        res.json({ user: req.lens.display, groups: await groupsFor(req.lens.sid) })
    })

    // The person's preferences (their theme): read, and change (remembered).
    app.get('/api/prefs', requireSession, (req, res) => res.json(prefsOf(req)))
    app.post('/api/prefs', requireSession, (req, res) => {
        try { res.json(savePrefs(cfg.server, req.lens.display, { mode: req.body?.mode, palette: req.body?.palette }, prefsFile)) }
        catch (e) { res.status(400).json({ error: e.message }) }
    })

    app.get('/api/lenses', requireSession, async (req, res) => {
        const lens = await listLenses(cfg.server, { client: req.lens.client })
        const groups = await groupsFor(req.lens.sid)
        const visible = lens.filter(l => (l.status === 'published' || (cfg.showDrafts && l.status === 'draft')) && lensStore.canOpenLens(l, groups))
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
            const doc = await visibleLens(req, name)
            const result = await writeCells(req.lens.client, { cube: req.body?.cube, cells: req.body?.cells, allowedCubes: lensBridge.lensWrites(doc) })
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
            const doc = await visibleLens(req, name)
            const result = await runProcess(req.lens.client, { process, params, allowedProcesses: lensBridge.lensRuns(doc), user: req.lens.display })
            logRun({ server: cfg.server, app: 'lens', user: req.lens.display, lens: doc.name, process, params, status: result.status, message: result.message })
            res.json(result)
        } catch (e) {
            if (e.status) logRun({ server: cfg.server, app: 'lens', user: req.lens.display, lens: name, process, params, status: e.status, message: e.message })
            res.status(e.status ? 422 : 400).json({ error: e.response?.data?.error?.message ?? e.message, status: e.status })
        }
    })

    // A cell's story (right-click menu): why / who changed it / notes — as the person.
    for (const [route, fn] of [['cell-trace', (c, b) => lensBridge.cellTrace(c, b.cube, b.coordinates)],
                               ['cell-log',   (c, b) => lensBridge.cellLog(c, b.cube, b.coordinates, b.top)],
                               ['cell-notes', (c, b) => lensBridge.cellNotes(c, b.cube, b.coordinates)]]) {
        app.post(`/api/lens/${route}`, requireSession, serverGate, async (req, res) => {
            try { res.json(await fn(req.lens.client, req.body ?? {})) }
            catch (e) { res.status(400).json({ error: e.response?.data?.error?.message ?? e.message }) }
        })
    }
    app.post('/api/lens/add-note', requireSession, serverGate, async (req, res) => {
        try {
            const name = req.body?.lens
            if (!name || typeof name !== 'string') throw new Error('lens is required')
            const doc = await visibleLens(req, name)
            const note = await lensBridge.addCellNote(req.lens.client, { cube: req.body?.cube, coordinates: req.body?.coordinates, text: req.body?.text, allowedCubes: lensBridge.lensNotes(doc) })
            logLensNote({ server: cfg.server, app: 'lens', user: req.lens.display, lens: doc.name, ...note })
            res.json({ ok: true })
        } catch (e) { res.status(400).json({ error: e.response?.data?.error?.message ?? e.message }) }
    })

    // Lens.pivot: a dimension's hierarchies (main + any ALT H), read as the signed-in person.
    app.get('/api/lens/hierarchies', requireSession, serverGate, async (req, res) => {
        try { res.json(await hierarchies(req.lens.client, req.query?.dimension)) }
        catch (e) { res.status(400).json({ error: e.response?.data?.error?.message ?? e.message }) }
    })

    // Lens.pivot: one dimension's element tree, read as the signed-in person.
    app.get('/api/lens/element-tree', requireSession, serverGate, async (req, res) => {
        try { res.json(await elementTree(req.lens.client, req.query?.dimension, req.query?.hierarchy)) }
        catch (e) { res.status(400).json({ error: e.response?.data?.error?.message ?? e.message }) }
    })

    app.get('/api/lens/meta', requireSession, serverGate, async (req, res) => {
        try { res.json(await getMeta(req.lens.client, req.query?.cube)) }
        catch (e) { res.status(400).json({ error: e.response?.data?.error?.message ?? e.message }) }
    })

    // ── Working together: live channel + history ──────────────────────────────
    const hub = deps.liveHub ?? createLiveHub()
    const readActivity = deps.readLensActivity ?? readLensActivity
    const visibleLens = async (req, name) => {
        const doc = await readLens(cfg.server, name, { client: req.lens.client })
        if (!(doc.status === 'published' || (cfg.showDrafts && doc.status === 'draft'))) throw new Error(`Lens "${name}" is not available here`)
        await openable(req.lens.sid, doc)
        return doc
    }
    const channelOf = v => String(v ?? '').slice(0, 200)

    // One stream per open Lens: who else is here, and what they do (Server-Sent
    // Events). The host page relays it into the Lens frame.
    app.get('/api/live/:name', requireSession, async (req, res) => {
        try { await visibleLens(req, req.params.name) } catch (e) { return res.status(404).json({ error: e.message }) }
        res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive' })
        res.flushHeaders?.()
        const me = hub.join(req.params.name, channelOf(req.query.channel), req.lens.display, ev => res.write(`data: ${JSON.stringify(ev)}\n\n`))
        // A short beat, so a connection that died without saying goodbye is
        // noticed (and its ghost leaves the room) within seconds.
        const beat = setInterval(() => { try { if (!res.write(': keep-alive\n\n') && res.destroyed) me.leave() } catch { me.leave() } }, 10_000)
        res.on('error', () => me.leave())
        req.on('close', () => { clearInterval(beat); me.leave() })
    })

    app.post('/api/live/:name', requireSession, (req, res) => {
        try {
            const out = hub.publish(req.params.name, channelOf(req.body?.channel), req.lens.display, String(req.body?.conn ?? ''), req.body?.event)
            res.json({ ok: true, at: out.at })
        } catch (e) { res.status(400).json({ error: e.message }) }
    })

    // The Lenses this person may open. Home uses it to hide steps that aren't
    // theirs; opening a restricted Lens is still refused by openable().
    app.get('/api/lens/lenses', requireSession, serverGate, async (req, res) => {
        try {
            const all = await listLenses(cfg.server, { client: req.lens.client })
            const groups = await groupsFor(req.lens.sid)
            res.json(all.filter(d => lensStore.canOpenLens(d, groups))
                .map(d => ({ name: d.name, title: d.title, folder: d.folder, icon: d.icon, color: d.color, description: d.description })))
        } catch (e) { res.status(400).json({ error: e.message }) }
    })

    // History: recent saves and runs through this Lens, for one slice the person
    // can see (match = { dimension: element }, checked as them against the
    // Lens's own cube before anything is returned).
    app.get('/api/lens/:name/history', requireSession, async (req, res) => {
        try {
            const doc = await visibleLens(req, req.params.name)
            let match = {}
            try { match = JSON.parse(String(req.query.match ?? '{}')) } catch { throw new Error('match must be JSON') }
            if (!match || typeof match !== 'object' || Array.isArray(match)) throw new Error('match must be { dimension: element }')
            const cube = lensBridge.lensWrites(doc)[0]
            if (!cube && Object.keys(match).length) throw new Error('a history slice needs a Lens that changes data (lens-writes)')
            for (const [dim, el] of Object.entries(match)) {
                // Fails for a member this person may not see — then nothing is returned.
                await execMdx(req.lens.client, `SELECT {} ON 0, {[${String(dim).replace(/]/g, ']]')}].[${String(dim).replace(/]/g, ']]')}].[${String(el).replace(/]/g, ']]')}]} ON 1 FROM [${cube.replace(/]/g, ']]')}]`)
                    .catch(() => { throw new Error(`you can't see ${dim} "${el}"`) })
            }
            const skip = String(req.query.skip ?? '').split(',').map(x => x.trim()).filter(Boolean).slice(0, 20)
            res.json(readActivity({ server: cfg.server, lens: doc.name, match, skip, limit: Math.min(Number(req.query.limit) || 30, 100) }))
        } catch (e) { res.status(400).json({ error: e.message }) }
    })

    app.get('/api/lens/:name', requireSession, async (req, res) => {
        try {
            const doc = await openable(req.lens.sid, await readLens(cfg.server, req.params.name, { client: req.lens.client }))
            const want = Number(doc.toolkitVersion) || 1
            if (want > supported) {
                return res.status(417).json({ error: `This Lens needs toolkit version ${want}; this Lens app supports up to ${supported}.`, name: doc.name })
            }
            const { html: _own, ...meta } = doc
            res.json({ html: doc.html ?? '', meta })
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