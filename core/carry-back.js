'use strict'

// ── Carry-back: bring PROD's version onto DEV (Part D.4) ─────────────────────
// When a rule or process was hand-edited on PROD, three copies exist: PROD Last
// Deployed (old), PROD Live (the edit) and DEV. Deploying DEV back over PROD
// would be circular, so the IDE copies PROD's text ONTO DEV through TM1's REST
// API in a new change set of kind `carry-back`.
//
// The change set is closed like any other (Part F) and is already on PROD: it
// is never deployed to PROD. It is deployable to TEST normally, where the same
// text has to land for UAT.
//
// Before anything is written, every open or undeployed change set that changed
// the same object is named and the copy stops — two versions of one whole object
// have no safe order.

const cl = require('./change-log')

const OBJECT_TYPES = new Set(['rules', 'process'])
const norm = (s) => String(s ?? '').toLowerCase()

function sameObject(entry, object) {
    const type = object.type === 'rules' ? 'rules' : 'process'
    return entry?.object_type === type && norm(entry?.object_name) === norm(object.name)
}

// Open, or closed and not deployed to any server, and still owns the object.
function clashingSets(server, objects, { exceptId = null } = {}) {
    const wanted = (objects ?? []).filter(o => OBJECT_TYPES.has(o.type) && o.name)
    if (!wanted.length) return []
    const out = []
    for (const s of cl.getSessions(server, 1000)) {
        if (s.id === exceptId) continue
        if (s.wont_deploy_at || s.covered_by) continue
        if (cl.hasAnyDeploy(s.id)) continue           // already on a server — not "undeployed"
        let entries
        try { entries = cl.getSessionLog(s.id) } catch { continue }
        const hits = wanted.filter(o => entries.some(e => sameObject(e, o)))
        if (hits.length) out.push({ id: s.id, name: s.name, user: s.user ?? null, objects: hits.map(o => `${o.type} ${o.name}`) })
    }
    return out
}

// Read one object's text from a server. Only the code: parameters, variables and
// the datasource are not part of "the rule/process text" (D.4).
async function readObject(client, object) {
    if (object.type === 'rules') {
        const cube = await client.get(`Cubes('${require('./odata-key').odataKey(object.name)}')`, { $select: 'Name,Rules' }).catch(() => null)
        if (!cube) throw new Error(`Cube "${object.name}" does not exist on ${client.server}.`)
        return { rules: String(cube.Rules ?? '') }
    }
    if (object.type === 'process') {
        const p = await client.get(`Processes('${require('./odata-key').odataKey(object.name)}')`).catch(() => null)
        if (!p) throw new Error(`Process "${object.name}" does not exist on ${client.server}.`)
        return {
            prolog: String(p.PrologProcedure ?? ''),
            metadata: String(p.MetadataProcedure ?? ''),
            data: String(p.DataProcedure ?? ''),
            epilog: String(p.EpilogProcedure ?? ''),
        }
    }
    throw new Error(`A carry-back copies a rule or a process, not a ${object.type}.`)
}

function sameText(object, a, b) {
    if (object.type === 'rules') return String(a?.rules ?? '') === String(b?.rules ?? '')
    return ['prolog', 'metadata', 'data', 'epilog'].every(k => String(a?.[k] ?? '') === String(b?.[k] ?? ''))
}

async function writeObject(client, object, text) {
    const { odataKey } = require('./odata-key')
    if (object.type === 'rules') {
        await client.patch(`Cubes('${odataKey(object.name)}')`, { Rules: text.rules })
        return
    }
    await client.patch(`Processes('${odataKey(object.name)}')`, {
        PrologProcedure: text.prolog,
        MetadataProcedure: text.metadata,
        DataProcedure: text.data,
        EpilogProcedure: text.epilog,
    })
}

// Bring the listed objects' PROD text onto DEV. All-or-nothing on the clash
// check; once writing starts, a failed write is reported and the set is left
// open (never silent).
async function bringToDev({ target, dev, objects, user, name = null }, {
    token, gitUser, ideToken,
    clientFor = null,
    close = null,
    finalize = null,
    runTests = null,
} = {}) {
    const wanted = (objects ?? []).filter(o => OBJECT_TYPES.has(o.type) && o.name)
    if (!wanted.length) return { ok: false, error: 'Choose a rule or a process to bring back from PROD.' }
    if (!target || !dev) return { ok: false, error: 'target and dev are required' }
    if (norm(target) === norm(dev)) return { ok: false, error: 'The target and DEV must be different servers.' }

    const clashes = clashingSets(dev, wanted)
    if (clashes.length) {
        return {
            ok: false,
            refused: true,
            clashes,
            error: `Cannot bring PROD's version onto DEV: ${clashes.map(c => `change set "${c.name}"${c.user ? ` (${c.user})` : ''} also changes ${c.objects.join(', ')}`).join('; ')}. Deploy or retire ${clashes.length === 1 ? 'it' : 'them'} first, or make the change in that change set.`,
        }
    }

    const makeClient = clientFor ?? ((server) => {
        const { makeClient: mc } = require('./adapter-registry')
        const { TM1Client } = require('./tm1-client')
        return new TM1Client(server, mc(server, ideToken))
    })
    const prod = makeClient(target)
    const devClient = makeClient(dev)

    // Read everything before writing anything, so a missing object names itself
    // without leaving a half-done change set behind.
    const live = []
    for (const object of wanted) {
        try { live.push({ object, text: await readObject(prod, object) }) }
        catch (e) { return { ok: false, error: e.message } }
    }

    const label = name || `Bring PROD's ${wanted.map(o => o.name).join(', ')} onto DEV`
    const session = cl.startSession(label, dev, user, 'carry-back')

    const written = []
    for (const { object, text } of live) {
        let before
        try { before = await readObject(devClient, object) }
        catch (e) {
            return { ok: false, session, error: `Could not read ${object.type} ${object.name} on DEV before writing: ${e.message}` }
        }
        if (sameText(object, before, text)) {
            written.push({ ...object, changed: false })
            continue
        }
        try { await writeObject(devClient, object, text) }
        catch (e) {
            return { ok: false, session, error: `Could not write ${object.type} ${object.name} onto DEV: ${e.message}. The change set "${label}" is left open.` }
        }
        if (object.type === 'rules') {
            cl.writeLog({
                server: dev, action: 'RULES_SAVED', objectType: 'rules', objectName: object.name,
                beforeState: { text: before.rules }, afterState: { text: text.rules }, user,
            })
        } else {
            cl.writeLog({
                server: dev, action: 'PROCESS_SAVED', objectType: 'process', objectName: object.name,
                beforeState: before, afterState: text, user,
            })
        }
        written.push({ ...object, changed: true })
    }

    cl.updateSessionDescription(session.id, `Already on PROD: PROD's own text was brought onto DEV. Never deployed to PROD; deployable to TEST.`)

    // Close it (Part F.4.1): DEV's tests run first, and a failing block test
    // leaves the set open. The copy is PROD's own text, but DEV's model still
    // has to pass its tests before the set can be closed.
    let tests = null
    try {
        const run = runTests ?? ((srv) => require('./assertions').run(srv, { ideToken }))
        const r = await run(dev)
        const blocking = (r.results ?? []).filter(x => !x.pass && (x.severity ?? 'block') === 'block')
        if (blocking.length) {
            return {
                ok: false, session, written,
                error: `The copy landed on DEV, but ${blocking.length} block test${blocking.length === 1 ? '' : 's'} fail, so change set "${label}" is left open: ${blocking.map(b => b.description).join('; ')}.`,
            }
        }
        tests = { passed: r.passed, total: r.total, blocking: 0 }
    } catch (e) {
        return { ok: false, session, written, error: `The copy landed on DEV, but DEV's tests could not run, so change set "${label}" is left open: ${e.message}` }
    }

    // Injectable so the rules are tested without Git/TM1.
    const closeIt = close ?? ((id, opts) => require('./change-set-service').closeChangeSet(id, opts))
    const finalise = finalize ?? ((srv, id, opts) => require('./close-check').finalizeDevClose(srv, id, opts))
    let closed = null
    let finalized = null
    try { closed = await closeIt(session.id, { user, tests, ideToken }) }
    catch (e) { return { ok: false, session, written, error: `The copy landed on DEV but the change set could not be closed: ${e.message}` } }
    try { finalized = await finalise(dev, session.id, { token, gitUser, ideToken, user }) }
    catch (e) { finalized = { ok: false, error: e.message } }

    return {
        ok: true,
        session: closed ?? session,
        written,
        alreadyOnProd: true,
        finalized,
        note: `PROD's version of ${wanted.map(o => o.name).join(', ')} is now on DEV in change set "${label}". It is already on PROD — never deployed there; deploy it to TEST normally.`,
    }
}

module.exports = { bringToDev, clashingSets, readObject, sameText, OBJECT_TYPES }
