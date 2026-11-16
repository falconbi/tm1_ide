'use strict'

const AREAS = ['ti', 'rules']
const SECTIONS = ['overrides', 'additions']
const PROTO_KEYS = new Set(['__proto__', 'prototype', 'constructor'])
const ENTRY_KEYS = new Set(['params', 'compat', 'returnType', 'description', 'deprecated', 'isStatement', 'language', 'variadicMin'])
const COMPAT = new Set(['both', 'v11', 'v12'])

const emptyArea = () => ({ overrides: {}, additions: {}, deletions: [] })

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

module.exports = { normalizeOverrides, AREAS, emptyArea }
