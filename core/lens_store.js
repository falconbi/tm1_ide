'use strict'

const fs   = require('fs')
const path = require('path')

const LENSES_DIR = path.join(__dirname, '..', 'config', 'lenses')
const LENSES_CUBE    = '}Lenses'
const LENSES_NAME_DIM  = '}Lenses_Name'
const LENSES_FIELD_DIM = '}Lenses_Field'
const FIELDS = ['Status', 'Owner', 'Version', 'Updated', 'Description']

function safeName(name) {
    const n = String(name ?? '').trim()
    if (!/^[a-zA-Z0-9_-]+$/.test(n)) throw new Error(`Invalid lens name "${n}" — use letters, digits, - or _`)
    return n
}

function lensPath(name) {
    return path.join(LENSES_DIR, `${safeName(name)}.html`)
}

function listFiles() {
    fs.mkdirSync(LENSES_DIR, { recursive: true })
    return fs.readdirSync(LENSES_DIR)
        .filter(f => f.endsWith('.html'))
        .map(f => {
            const stat = fs.statSync(path.join(LENSES_DIR, f))
            return { name: f.slice(0, -5), file: f, modified: stat.mtime.toISOString(), size: stat.size }
        })
        .sort((a, b) => a.name.localeCompare(b.name))
}

function readLens(name) {
    const p = lensPath(name)
    if (!fs.existsSync(p)) throw new Error(`Lens "${name}" not found`)
    return { name, html: fs.readFileSync(p, 'utf8') }
}

async function ensureLensesCube(client) {
    try {
        await client.getCube(LENSES_CUBE)
        return
    } catch {}
    try { await client.createDimension(LENSES_NAME_DIM) } catch {}
    try { await client.createDimension(LENSES_FIELD_DIM) } catch {}
    await client.bulkSetElements(LENSES_FIELD_DIM, FIELDS.map(f => ({ name: f, type: 'S' }))).catch(() => {})
}

async function writeMeta(client, name, updates) {
    try {
        await ensureLensesCube(client)
        await client.bulkSetElements(LENSES_NAME_DIM, [{ name, type: 'N' }]).catch(() => {})
        for (const [field, value] of Object.entries(updates)) {
            await client.writeCellValue(LENSES_CUBE, [
                { dim: LENSES_NAME_DIM, element: name },
                { dim: LENSES_FIELD_DIM, element: field },
            ], String(value)).catch(() => {})
        }
    } catch {}
}

async function readMeta(client, name) {
    const meta = {}
    try {
        await ensureLensesCube(client)
        const mdx = `SELECT {${FIELDS.map(f => `[${LENSES_FIELD_DIM}].[${f}]`).join(',')}} ON 0, {[${LENSES_NAME_DIM}].[${name}]} ON 1 FROM [${LENSES_CUBE}]`
        const r = await client.executeMDX(mdx, 100)
        const cols = (r.Axes?.[0]?.Tuples ?? []).map(t => t.Members?.[0]?.Name)
        const rows = (r.Axes?.[1]?.Tuples ?? []).map(t => t.Members?.[0]?.Name)
        const nCols = cols.length
        for (const c of r.Cells ?? []) {
            const col = cols[c.Ordinal % nCols]
            if (col) meta[col] = c.Value
        }
    } catch {}
    return meta
}

function saveLens(client, name, html, owner, opts = {}) {
    const safe = safeName(name)
    fs.mkdirSync(LENSES_DIR, { recursive: true })
    fs.writeFileSync(lensPath(safe), html)
    const status = opts.publish ? 'published' : 'draft'
    const version = String(parseInt(String(opts.version ?? '1')) || 1)
    if (client) {
        writeMeta(client, safe, {
            Status: status,
            Owner: owner ?? 'unknown',
            Version: version,
            Updated: new Date().toISOString(),
            Description: opts.description ?? '',
        })
    }
    return { name: safe, status, version }
}

function deleteLens(name) {
    const p = lensPath(name)
    if (fs.existsSync(p)) fs.unlinkSync(p)
}

module.exports = { LENSES_DIR, safeName, listFiles, readLens, saveLens, deleteLens, readMeta, writeMeta, ensureLensesCube, LENSES_CUBE }