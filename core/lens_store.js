'use strict'

// ── Lens store — Lenses live in the model ─────────────────────────────────────
// One JSON document per Lens under Applications/Governance/Lenses/<name>.json,
// holding the HTML and its details together (one source of truth — no second
// metadata copy). Reuses core/model-store.js, the same storage as tests, change
// sets and approvals. There is no local storage: a private model's Lenses stay
// with the model and can never land in the IDE's (public) repo.

const store = require('./model-store')

const AREA = 'lenses'

// Bumped when the bridge/toolkit contract changes, so the Lens app can refuse a
// Lens it can't run (LENS_APP_PLAN.md — version check).
const TOOLKIT_VERSION = 9   // 2 = the Lens toolkit (window.Lens) is available — shared/lens-kit

function safeName(name) {
    const n = String(name ?? '').trim()
    if (!/^[a-zA-Z0-9_-]+$/.test(n)) throw new Error(`Invalid lens name "${n}" — use letters, digits, - or _`)
    return n
}

const docName = name => `${safeName(name)}.json`

// A Lens's folder on the Lens app home page: 'Finance' or 'Planning/Forecast'
// ('/' makes a sub-folder). Just a label stored with the Lens — the file stays
// where it is, so moving a Lens is changing one field. '' = no folder.
function cleanFolder(folder) {
    const parts = String(folder ?? '').split('/').map(p => p.trim().replace(/\s+/g, ' ')).filter(Boolean)
    const f = parts.join('/')
    if (f.length > 120) throw new Error('Folder name too long (120 characters at most)')
    if (/[<>"\\]/.test(f)) throw new Error('Folder names can\'t contain < > " or \\')
    return f
}

// Details only (no HTML) for every Lens in this server's model, sorted by name.
async function listLenses(server, { ideToken, client } = {}) {
    const names = (await store.listDocs(server, AREA, { ideToken, client })).filter(n => n.endsWith('.json'))
    const out = []
    for (const n of names) {
        const doc = await store.readDoc(server, AREA, n, { ideToken, client })
        if (!doc) continue
        const { html: _html, ...details } = doc
        out.push(details)
    }
    return out.sort((a, b) => String(a.name).localeCompare(String(b.name)))
}

// One Lens, HTML included. Missing is an error.
async function readLens(server, name, { ideToken, client } = {}) {
    const doc = await store.readDoc(server, AREA, docName(name), { ideToken, client })
    if (!doc) throw new Error(`Lens "${safeName(name)}" not found on ${server}`)
    return doc
}

// Create or update a Lens. The version counts up on every save; created/createdBy
// are kept from the first save. Throws if the model can't be written.
// title: what people see in the Lens app ("Enter targets"); the name stays the
// Lens's id (Target-Input). A leading number in the title ("1 Enter targets")
// orders the steps of a process folder; '' = show the name.
// icon: one of shared/lens-icons.json; color: '#rrggbb' for its tile; image: a
// data: URL (PNG / JPEG / WebP / SVG, at most 200 KB) used instead of the icon —
// '' clears it. All three keep their current value when left out.
const ICON_NAMES = Object.keys(require('../shared/lens-icons.json')).filter(k => !k.startsWith('_'))
function cleanIcon(icon) {
    const i = String(icon ?? '').trim()
    if (i && !ICON_NAMES.includes(i)) throw new Error(`Unknown icon "${i}"`)
    return i
}
function cleanColor(color) {
    const c = String(color ?? '').trim()
    if (c && !/^#[0-9a-fA-F]{6}$/.test(c)) throw new Error('Tile colour must look like #0f766e')
    return c
}
function cleanImage(image) {
    const v = String(image ?? '')
    if (!v) return ''
    if (!/^data:image\/(png|jpeg|webp|svg\+xml);base64,[A-Za-z0-9+/=]+$/.test(v)) throw new Error('The image must be a PNG, JPEG, WebP or SVG picture')
    if (v.length > 200 * 1024 * 4 / 3 + 100) throw new Error('The image is too large (200 KB at most)')
    return v
}

// config: the Lens's settings — its bindings and behaviour, read by its code
// through Lens.config(). Free-form for the Lens, except the keys the platform
// itself acts on: access (TM1 groups allowed to open it; empty = everyone),
// theme ('fixed' keeps the Lens's own look), writes (cubes it may change) and
// runs (processes it may run) — added to its <meta> tags. A plain JSON object,
// at most 64 KB.
const CONFIG_THEMES = ['', 'fixed']
function cleanConfig(config) {
    if (config === '' ) return {}
    if (!config || typeof config !== 'object' || Array.isArray(config)) throw new Error('The config must be a JSON object, e.g. { "access": ["Finance"] }')
    const text = JSON.stringify(config)
    if (text.length > 64 * 1024) throw new Error('The config is too large (64 KB at most)')
    const out = JSON.parse(text)
    if (out.access !== undefined) {
        if (!Array.isArray(out.access) || out.access.some(g => typeof g !== 'string' || !g.trim() || g.length > 100) || out.access.length > 50) {
            throw new Error('config.access must be a list of TM1 group names, e.g. ["Finance", "HR Approvers"]')
        }
        out.access = [...new Set(out.access.map(g => g.trim()))]
    }
    if (out.theme !== undefined && !CONFIG_THEMES.includes(out.theme)) throw new Error('config.theme can only be "fixed" (keep the Lens\'s own look)')
    for (const k of ['writes', 'runs']) {
        if (out[k] !== undefined && (!Array.isArray(out[k]) || out[k].some(x => typeof x !== 'string' || !x.trim()))) {
            throw new Error(`config.${k} must be a list of ${k === 'writes' ? 'cube' : 'process'} names`)
        }
    }
    return out
}

async function saveLens(server, name, html, owner, { publish = false, description, folder, title, icon, color, image, config, ideToken, client } = {}) {
    const safe = safeName(name)
    const existing = await store.readDoc(server, AREA, docName(safe), { ideToken, client })
    const now = new Date().toISOString()
    const doc = {
        name:           safe,
        status:         publish ? 'published' : 'draft',
        owner:          owner ?? 'unknown',
        version:        (Number(existing?.version) || 0) + 1,
        updated:        now,
        description:    description ?? existing?.description ?? '',
        folder:         folder === undefined || folder === null ? (existing?.folder ?? '') : cleanFolder(folder),
        title:          title === undefined || title === null ? (existing?.title ?? '') : String(title).trim().slice(0, 120),
        icon:           icon === undefined || icon === null ? (existing?.icon ?? '') : cleanIcon(icon),
        color:          color === undefined || color === null ? (existing?.color ?? '') : cleanColor(color),
        image:          image === undefined || image === null ? (existing?.image ?? '') : cleanImage(image),
        config:         config === undefined || config === null ? (existing?.config ?? {}) : cleanConfig(config),
        created:        existing?.created ?? now,
        createdBy:      existing?.createdBy ?? owner ?? 'unknown',
        toolkitVersion: TOOLKIT_VERSION,
        html,
    }
    if (typeof doc.html !== 'string' || !doc.html.trim()) throw new Error('A Lens needs its code (html)')
    await store.writeDoc(server, AREA, docName(safe), doc, { ideToken, client })
    const { html: _html, ...details } = doc
    return details
}

async function deleteLens(server, name, { ideToken, client } = {}) {
    await store.deleteDoc(server, AREA, docName(name), { ideToken, client })
}

// May this person open the Lens? config.access lists TM1 groups; empty = everyone.
// ADMIN always may. groups: the person's TM1 group names.
function canOpenLens(doc, groups = []) {
    const allowed = Array.isArray(doc?.config?.access) ? doc.config.access : []
    if (!allowed.length) return true
    const mine = new Set(groups.map(g => String(g).toLowerCase()))
    return mine.has('admin') || allowed.some(g => mine.has(String(g).toLowerCase()))
}

module.exports = { safeName, cleanFolder, cleanIcon, cleanColor, cleanImage, cleanConfig, canOpenLens, ICON_NAMES, listLenses, readLens, saveLens, deleteLens, TOOLKIT_VERSION }
