'use strict'

const fs = require('fs')
const crypto = require('crypto')

const AREAS = ['ti', 'rules']
const SECTIONS = ['overrides', 'additions']
const PROTO_KEYS = new Set(['__proto__', 'prototype', 'constructor'])
const ENTRY_KEYS = new Set(['params', 'compat', 'returnType', 'description', 'deprecated', 'isStatement', 'language', 'variadicMin'])
const COMPAT = new Set(['both', 'v11', 'v12'])

const emptyArea = () => ({ overrides: {}, additions: {}, deletions: [] })
const EMPTY_OVERRIDES = Object.freeze({ ti: emptyArea(), rules: emptyArea() })
const catalogVersion = raw => crypto.createHash('sha1').update(JSON.stringify(raw)).digest('hex').slice(0, 12)

function bad(message) {
    const e = new Error(message)
    e.status = 400
    throw e
}

function plainObject(value, what) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) bad(`${what} must be an object`)
}

function checkName(name, what) {
    if (PROTO_KEYS.has(name)) bad(`${what} contains a reserved key "${name}"`)
    if (!name.trim()) bad(`${what} contains an empty key`)
}

function checkEntry(name, entry) {
    plainObject(entry, `entry ${name}`)
    for (const key of Object.keys(entry)) {
        if (!ENTRY_KEYS.has(key)) bad(`entry ${name} has unknown field "${key}"`)
    }
    if (entry.params !== undefined && (!Array.isArray(entry.params) || entry.params.some(p => typeof p !== 'string'))) {
        bad(`entry ${name}.params must be an array of strings`)
    }
    if (entry.compat !== undefined && !COMPAT.has(entry.compat)) bad(`entry ${name}.compat must be both, v11 or v12`)
    if (entry.returnType !== undefined && typeof entry.returnType !== 'string') bad(`entry ${name}.returnType must be a string`)
    if (entry.description !== undefined && typeof entry.description !== 'string') bad(`entry ${name}.description must be a string`)
    if (entry.deprecated !== undefined && entry.deprecated !== null && typeof entry.deprecated !== 'string') bad(`entry ${name}.deprecated must be a string or null`)
    if (entry.isStatement !== undefined && typeof entry.isStatement !== 'boolean') bad(`entry ${name}.isStatement must be true or false`)
    if (entry.language !== undefined && !['rules', 'ti', 'both'].includes(entry.language)) bad(`entry ${name}.language is not valid`)
    if (entry.variadicMin !== undefined && !Number.isInteger(entry.variadicMin)) bad(`entry ${name}.variadicMin must be an integer`)
}

function normalizeOverrides(raw) {
    plainObject(raw, 'Catalog overrides')
    for (const area of Object.keys(raw)) {
        if (!AREAS.includes(area)) bad(`Unknown catalog area "${area}" — only ti and rules are editable`)
    }
    const out = {}
    for (const area of AREAS) {
        const src = raw[area] ?? {}
        plainObject(src, area)
        const dst = emptyArea()
        for (const section of SECTIONS) {
            const map = src[section] ?? {}
            plainObject(map, `${area}.${section}`)
            for (const [name, entry] of Object.entries(map)) {
                checkName(name, `${area}.${section}`)
                checkEntry(name, entry)
                dst[section][name] = entry
            }
        }
        const deletions = src.deletions ?? []
        if (!Array.isArray(deletions)) bad(`${area}.deletions must be an array`)
        for (const name of deletions) {
            if (typeof name !== 'string') bad(`${area}.deletions must contain only function names`)
            checkName(name, `${area}.deletions`)
        }
        dst.deletions = [...new Set(deletions)]
        out[area] = dst
    }
    return out
}

function createCatalogOverrideRoutes({ filePath, requireTm1Admin, gateReadOnly, serverOf }) {
    async function get(req, res) {
        const server = serverOf(req)
        try {
            if (!(await requireTm1Admin(req, res, server))) return
            const raw = fs.existsSync(filePath)
                ? normalizeOverrides(JSON.parse(fs.readFileSync(filePath, 'utf8')))
                : EMPTY_OVERRIDES
            res.json({ overrides: raw, version: catalogVersion(raw) })
        } catch (e) { res.status(e.status ?? 500).json({ error: e.message }) }
    }

    async function put(req, res) {
        const server = serverOf(req)
        try {
            if (!gateReadOnly(res, server)) return
            if (!(await requireTm1Admin(req, res, server))) return
            const overrides = normalizeOverrides(req.body?.overrides ?? req.body)
            fs.writeFileSync(filePath, JSON.stringify(overrides, null, 2))
            res.json({ ok: true, version: catalogVersion(overrides) })
        } catch (e) { res.status(e.status ?? 500).json({ error: e.message }) }
    }

    return { get, put }
}

module.exports = { normalizeOverrides, createCatalogOverrideRoutes, EMPTY_OVERRIDES, AREAS, emptyArea }
