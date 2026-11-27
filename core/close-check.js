'use strict'

// ── Tests and close: the parts that must stop (Part F.4) ────────────────────
// Close runs DEV's tests (the route does that), then checks three things only a
// person can see:
//
//   1. attribute values changed on DEV since the last close, with their owner —
//      this change set, another change set, or nobody;
//   2. an attribute type changed text ↔ number: a HARD STOP (TM1 clears values);
//   3. DEV deleted an attribute, dimension or cube that a DEV process writes or
//      reads: a HARD STOP — fix the process in the same change set.
//
// Nothing is written by this check. The close itself, after the caller marks the
// set closed, has TM1 on DEV write `dev` (DEV After Close) and the IDE write
// `attrs-DEV` — finalizeDevClose below.

const { makeClient } = require('./adapter-registry')
const { TM1Client } = require('./tm1-client')
const cl = require('./change-log')
const { recordedChanges } = require('./recorded-changes')
const { collectAttrsFiles, writeAttrsBranch, parseAttributes } = require('./git-attrs')
const { openBase } = require('./deploy-base')
const { gitLabel, pushServerState } = require('./git-setup')
const { fetchProcesses, scanProcess } = require('./process-scan')

const norm = (s) => String(s ?? '').toLowerCase()
const isNumericType = (t) => /^(n|num)/i.test(String(t ?? ''))
const typeClass = (t) => isNumericType(t) ? 'number' : 'text'

// Parse the attrs files map into { dim → document }.
function docsFromFiles(files) {
    const out = {}
    for (const [rel, text] of Object.entries(files ?? {})) {
        const m = String(rel).match(/^attributes\/(.+)\.json$/)
        if (!m) continue
        try { out[m[1]] = parseAttributes(String(text)) } catch { /* unreadable */ }
    }
    return out
}

// Read attrs-<server> at a commit. Missing/unreadable → {} (the last close has no
// baseline; that is reported, not treated as "nothing changed").
function readAttrsAtCommit(repoUrl, commit, { token: _token, gitUser: _gitUser } = {}) {
    if (!repoUrl || !commit) return {}
    try {
        const reader = openBase(repoUrl, commit)
        const out = {}
        for (const file of reader.list('attributes/')) {
            const m = String(file).match(/^attributes\/(.+)\.json$/)
            if (!m) continue
            try { out[m[1]] = parseAttributes(reader.show(file)) } catch { /* skip */ }
        }
        return out
    } catch { return {} }
}

// Attribute definition type changes (text ↔ number) between two attribute files.
function attributeTypeStops(before, after) {
    const stops = []
    for (const [dim, doc] of Object.entries(after ?? {})) {
        const old = before?.[dim]
        const oldDefs = new Map(((old?.attributes) ?? []).map(a => [norm(a.Name), a.Type]))
        for (const a of doc?.attributes ?? []) {
            const was = oldDefs.get(norm(a.Name))
            if (!was) continue
            if (typeClass(was) !== typeClass(a.Type)) {
                stops.push(`${dim}.${a.Name}: attribute type ${was} → ${a.Type} (a text ↔ number change clears its values)`)
            }
        }
    }
    return stops
}

// Every attribute value that differs between the last close and DEV now.
// `ownerOf` decides whether this change set, another, or nobody recorded it.
function changedAttributeValues(before, after, { ownerOf = () => null } = {}) {
    const out = []
    for (const [dim, doc] of Object.entries(after ?? {})) {
        const old = before?.[dim]
        const oldEls = new Map(((old?.elements) ?? []).map(e => [norm(e.Name), e.Values ?? e.values ?? {}]))
        for (const e of doc?.elements ?? []) {
            const was = oldEls.get(norm(e.Name)) ?? {}
            const now = e.Values ?? e.values ?? {}
            for (const [attribute, value] of Object.entries(now)) {
                if (String(was[attribute] ?? '') === String(value ?? '')) continue
                out.push({ dimension: dim, element: e.Name, attribute, before: was[attribute] ?? null, after: value ?? '', owner: ownerOf(dim, e.Name, attribute) })
            }
        }
    }
    return out
}

// Which change set last wrote one attribute value on this server.
function findValueOwner(server, dim, element, attribute, currentSessionId) {
    for (const s of cl.getAllSessions(500)) {
        if (s.server !== server || s.wont_deploy_at || s.covered_by) continue
        let entries
        try { entries = cl.getSessionLogVerbose(s.id) } catch { continue }
        for (let i = entries.length - 1; i >= 0; i--) {
            const e = entries[i]
            if (e.object_type !== 'attribute-value' && e.action !== 'ATTRIBUTE_VALUE_SET') continue
            let d = e.detail
            if (typeof d === 'string') { try { d = JSON.parse(d) } catch { d = null } }
            if (!d || norm(d.dimension) !== norm(dim) || norm(d.element) !== norm(element) || norm(d.attribute) !== norm(attribute)) continue
            return { sessionId: s.id, sessionName: s.name, user: s.user ?? null, mine: s.id === currentSessionId, open: !s.closed_at }
        }
    }
    return null
}

// A deleted attribute, dimension or cube a DEV process writes or reads.
async function scanDeletedUsage(client, deleted) {
    const dims = new Set((deleted.dimensions ?? []).map(norm))
    const cubes = new Set((deleted.cubes ?? []).map(norm))
    const attrs = (deleted.attributes ?? []).map(a => ({ dim: norm(a.dim), name: norm(a.name), label: a }))
    if (!dims.size && !cubes.size && !attrs.length) return []
    const all = await fetchProcesses(client).catch(() => [])
    const dimNames = new Set((await client.getDimensions().catch(() => [])).map(d => d?.Name ?? d).filter(Boolean))
    const cubeNames = new Set((await client.getCubes().catch(() => [])).map(c => c?.Name ?? c).filter(Boolean))
    const hits = []
    for (const proc of all ?? []) {
        const facts = scanProcess(proc, { dimNames, cubeNames, cubeDims: {} })
        const say = (what) => hits.push({ process: proc.Name, what })
        for (const w of facts.dimWrites ?? []) if (dims.has(norm(w.dim))) say(`writes dimension ${w.dim}`)
        for (const w of facts.writes ?? []) if (cubes.has(norm(w.cube))) say(`writes cube ${w.cube}`)
        for (const r of facts.reads ?? []) if (cubes.has(norm(r.cube))) say(`reads cube ${r.cube}`)
        for (const a of facts.attrWrites ?? []) {
            const hit = attrs.find(x => x.dim === norm(a.dim) && x.name === norm(a.attribute))
            if (hit) say(`writes attribute ${hit.label.dim}.${hit.label.name}`)
        }
        // Attribute reads are not in the write scanner; read them from the text.
        const text = [proc.PrologProcedure, proc.MetadataProcedure, proc.DataProcedure, proc.EpilogProcedure].filter(Boolean).join('\n')
        const re = /\b(AttrGet[SN]|ElementAttrGet[SN])\s*\(([^)]*)\)/g
        let m
        while ((m = re.exec(text)) !== null) {
            const args = m[2].split(',').map(s => s.trim())
            const lit = (x) => (x ?? '').match(/^'((?:''|[^'])*)'$/)?.[1]?.replace(/''/g, "'") ?? null
            const isElement = /^ElementAttrGet/i.test(m[1])
            const dim = lit(args[isElement ? 1 : 1])
            const attr = lit(args[isElement ? 4 : 3])
            if (!dim || !attr) continue
            const hit = attrs.find(x => x.dim === norm(dim) && x.name === norm(attr))
            if (hit) say(`reads attribute ${hit.label.dim}.${hit.label.name}`)
        }
    }
    return hits
}

// Run the close checks. `after` files are read from DEV now; `before` from the
// attrs branch's head (the last close). Never writes anything.
async function preCloseCheck(server, sessionId, { token, gitUser, ideToken, repoUrl = null, client = null, acceptValues = [] } = {}) {
    const session = cl.getSession(sessionId)
    if (!session) return { ok: false, error: `No change set ${sessionId}` }
    if (session.closed_at) return { ok: false, error: `Change set "${session.name}" is closed.` }

    let url = repoUrl
    if (!url) {
        try { url = (await (client ?? makeClient(server, ideToken)).post('GitStatus', { Username: gitUser, Password: token }))?.URL ?? null }
        catch { url = null }
    }

    const tm1 = new TM1Client(server, client ?? makeClient(server, ideToken))
    const after = docsFromFiles(await collectAttrsFiles(tm1))
    const { attrsHead } = require('./git-attrs')
    const baseCommit = url ? attrsHead(url, server, { token, gitUser }) : null
    const before = readAttrsAtCommit(url, baseCommit, { token, gitUser })

    const typeStops = attributeTypeStops(before, after)
    const values = changedAttributeValues(before, after, {
        ownerOf: (dim, element, attribute) => findValueOwner(server, dim, element, attribute, sessionId),
    })

    // Deleted objects that a process still uses.
    const entries = cl.getSessionLogVerbose(sessionId)
    const records = recordedChanges(entries)
    const deleted = {
        dimensions: (records.deletes ?? []).filter(d => d.type === 'dimension').map(d => d.name),
        cubes: (records.deletes ?? []).filter(d => d.type === 'cube').map(d => d.name),
        attributes: [],
    }
    for (const [dim, rec] of records.dimensions) {
        for (const a of rec.attrDefs ?? []) if (a.action === 'delete') deleted.attributes.push({ dim, name: a.name })
    }
    let used
    try { used = await scanDeletedUsage(tm1, deleted) } catch { used = [] }
    const usedStops = used.map(u => `${u.process} ${u.what}, which this change set deletes`)

    // Values the developer chooses to take into this change set (the ones with no
    // record). Another set's value can never be taken here.
    const wanted = new Set((acceptValues ?? []).map(v => `${norm(v.dimension)}::${norm(v.element)}::${norm(v.attribute)}`))
    const accepted = []
    for (const v of values) {
        if (!wanted.has(`${norm(v.dimension)}::${norm(v.element)}::${norm(v.attribute)}`)) continue
        if (v.owner) continue     // another set's (or this set's) value — never re-recorded
        cl.writeLog({
            server, action: 'ATTRIBUTE_VALUE_SET', objectType: 'attribute-value',
            objectName: `${v.dimension}:${v.element}:${v.attribute}`,
            detail: { dimension: v.dimension, hierarchy: v.dimension, element: v.element, attribute: v.attribute, before: v.before ?? null, after: v.after ?? null },
            user: null,
        })
        accepted.push({ dimension: v.dimension, element: v.element, attribute: v.attribute })
    }

    const stops = [...typeStops, ...usedStops]
    return {
        ok: stops.length === 0,
        stops,
        attributeTypeChanges: typeStops,
        attributeValues: values.map(v => ({
            ...v,
            owned: v.owner?.mine ? 'this change set' : v.owner ? `change set "${v.owner.sessionName}"` : 'no record — choose',
            take: !!v.owner?.mine,
            canTake: !v.owner,
        })),
        acceptedValues: accepted,
        deleted,
        deletedUsage: used,
        base: baseCommit,
    }
}

// After the set is closed: TM1 on DEV writes its objects into `dev` (DEV After
// Close), the commit is recorded on the change set, and the IDE writes attrs-DEV.
async function finalizeDevClose(server, sessionId, { token, gitUser, ideToken, user = null } = {}) {
    let label
    try { label = (await gitLabel(server, { token, gitUser, ideToken })).label } catch { label = null }
    if (label !== 'DEV') return { ok: true, skipped: true, reason: label ? `${server} is ${label}, not DEV` : `${server} is not linked` }

    const pushed = await pushServerState(server, 'dev', { token, gitUser, ideToken })
    if (pushed?.commit) {
        try { cl.setSessionCommit(sessionId, pushed.commit) } catch { /* recorded nowhere else */ }
    }
    let attrs
    try {
        const client = new TM1Client(server, makeClient(server, ideToken))
        const files = await collectAttrsFiles(client)
        const repoUrl = (await makeClient(server, ideToken).post('GitStatus', { Username: gitUser, Password: token }))?.URL
        attrs = await writeAttrsBranch(server, { repoUrl, token, gitUser, files, by: user, message: `DEV After Close attributes of ${server}` })
    } catch (e) { attrs = { ok: false, error: e.message } }
    return {
        ok: true, commit: pushed?.commit ?? null, attrsCommit: attrs?.commit ?? null,
        attrsError: attrs?.ok === false ? attrs.error : null,
    }
}

module.exports = {
    preCloseCheck, finalizeDevClose, attributeTypeStops, changedAttributeValues,
    findValueOwner, scanDeletedUsage, docsFromFiles, readAttrsAtCommit,
}
