'use strict'

// A closed change set is a phantom when none of the model objects it touched
// still exist. It is history only: it owns nothing and should be hidden from the
// active list automatically. This is a current-state check, never a manual mark.

function isPhantom(entries, objects) {
    for (const e of entries ?? []) {
        const type = e.object_type
        if (!type || type === 'process-run') continue
        if (type === 'subset') {
            // Conservative: a subset may still exist under a live dimension.
            if (e.detail && objects.dimensions.has(e.detail)) return false
            continue
        }
        if (type === 'view') {
            if (e.detail && objects.cubes.has(e.detail)) return false
            continue
        }
        if (type === 'attribute') {
            const dim = e.detail ?? e.object_name
            if (dim && objects.dimensions.has(dim)) return false
            continue
        }
        const kind = type === 'rules' ? 'cube' : type
        const set = objects[`${kind}s`]
        if (set && set.has(e.object_name)) return false
    }
    return true
}

async function findPhantomIds(server, sessions, { ideToken, client } = {}) {
    const c = client ?? require('./adapter-registry').makeClient(server, ideToken)
    const names = async route => ((await c.get(route, { $select: 'Name' })).value ?? []).map(x => x.Name)
    const objects = {
        cubes: new Set(await names('Cubes')),
        dimensions: new Set(await names('Dimensions')),
        processes: new Set(await names('Processes')),
        chores: new Set(await names('Chores')),
    }
    const cl = require('./change-log')
    const out = new Set()
    for (const s of sessions) {
        if (!s.closed_at) continue
        let entries
        try { entries = cl.getSessionLog(s.id) } catch { entries = [] }
        if (isPhantom(entries, objects)) out.add(s.id)
    }
    return out
}

module.exports = { isPhantom, findPhantomIds }
