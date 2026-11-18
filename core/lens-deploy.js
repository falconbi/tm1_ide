'use strict'

// ── Governed Lens deploy (no Git) ───────────────────────────────────────────
// Lenses are model-owned application documents under
// Applications/Governance/Lenses. Shipping them is a separate, explicit flow:
//
//   plan (compare source → target) → approve (bind the exact source hash)
//   → execute (take the target's deploy lock, save, read back) → history
//
// Only published source Lenses ship. A Lens whose declared writes/runs name a
// cube/process missing on the target is a blocker, not a warning. Approvals and
// history live in the TARGET model (Applications/Governance/LensDeploys), so
// every IDE pointed at that target sees the same decisions.

const crypto = require('crypto')
const lensStore = require('./lens-store')
const store = require('./model-store')
const { makeClient } = require('./adapter-registry')
const { lensWrites, lensRuns } = require('./lens-bridge')
const lock = require('./git-lock')

const AREA = 'lensDeploys'
const APPROVALS_DOC = 'approvals.json'
const HISTORY_DOC = 'history.json'

// The content of a Lens — everything that actually ships. Deployment bookkeeping
// (version/updated/owner/created/createdBy/toolkitVersion) is deliberately left
// out so the same content saved twice, by two people, has the same hash.
const CONTENT_KEYS = ['name', 'status', 'description', 'folder', 'title', 'icon', 'color', 'image', 'config', 'html']

function canonicalize(value) {
    if (Array.isArray(value)) return value.map(canonicalize)
    if (value && typeof value === 'object') {
        const out = {}
        for (const key of Object.keys(value).sort()) out[key] = canonicalize(value[key])
        return out
    }
    return value
}

function contentOf(doc) {
    const out = {}
    for (const key of CONTENT_KEYS) if (doc?.[key] !== undefined) out[key] = doc[key]
    return out
}

function lensHash(doc) {
    return crypto.createHash('sha256').update(JSON.stringify(canonicalize(contentOf(doc)))).digest('hex')
}

function hashOf(value) {
    return crypto.createHash('sha256').update(JSON.stringify(canonicalize(value))).digest('hex')
}

function refuse(message) {
    const e = new Error(`Refused: ${message}`)
    e.refused = true
    e.status = 409
    return e
}

function badRequest(message) {
    const e = new Error(message)
    e.status = 400
    return e
}

const lower = v => String(v).toLowerCase()

async function targetResources(target, { ideToken, client } = {}) {
    const c = client ?? makeClient(target, ideToken)
    const [cubes, processes] = await Promise.all([c.getModelCubes(), c.getProcesses()])
    return {
        cubes: new Set((cubes ?? []).map(lower)),
        processes: new Set((processes ?? []).map(lower)),
    }
}

function blockersFor(doc, resources) {
    const out = []
    for (const cube of lensWrites(doc)) {
        if (!resources.cubes.has(lower(cube))) {
            out.push({ kind: 'cube', name: cube, message: `writes cube "${cube}", which is missing on the target` })
        }
    }
    for (const process of lensRuns(doc)) {
        if (!resources.processes.has(lower(process))) {
            out.push({ kind: 'process', name: process, message: `runs process "${process}", which is missing on the target` })
        }
    }
    return out
}

// Compare every source Lens with the target, without changing anything. Drafts
// are listed for review but can never ship. Target-only Lenses are offered for
// deletion. `planHash` binds the exact set of source contents to an approval.
async function planLenses(source, target, opts = {}) {
    if (!source || !target) throw badRequest('source and target required')
    if (source === target) throw badRequest('source and target must be different servers')
    const { ideToken, client } = opts

    const [sourceList, targetList] = await Promise.all([
        lensStore.listLenses(source, { ideToken }),
        lensStore.listLenses(target, { ideToken }),
    ])
    const sourceNames = new Set(sourceList.map(l => l.name))
    const targetNames = new Set(targetList.map(l => l.name))

    const targetHashes = new Map()
    for (const meta of targetList) {
        try {
            targetHashes.set(meta.name, lensHash(await lensStore.readLens(target, meta.name, { ideToken })))
        } catch {
            // listLenses already surfaced unreadable docs in .errors; leave this
            // Lens out of the comparison rather than pretending it is absent.
        }
    }

    const prepared = []
    let needsResources = false
    for (const meta of sourceList) {
        const doc = await lensStore.readLens(source, meta.name, { ideToken })
        const published = doc.status === 'published'
        const hash = lensHash(doc)
        const action = !published
            ? 'draft'
            : !targetNames.has(doc.name)
                ? 'new'
                : targetHashes.get(doc.name) === hash ? 'same' : 'changed'
        if (published && action !== 'same') needsResources = true
        prepared.push({ doc, published, hash, action })
    }

    const resources = needsResources
        ? await targetResources(target, { ideToken, client })
        : { cubes: new Set(), processes: new Set() }

    const entries = prepared.map(({ doc, published, hash, action }) => {
        const blockers = published && (action === 'new' || action === 'changed')
            ? blockersFor(doc, resources)
            : []
        return {
            name: doc.name,
            title: doc.title || doc.name,
            status: doc.status,
            action,
            sourceHash: hash,
            targetHash: targetHashes.get(doc.name) ?? null,
            published,
            blockers,
            ship: published && (action === 'new' || action === 'changed') && blockers.length === 0,
            enabled: published && (action === 'new' || action === 'changed') && blockers.length === 0,
        }
    })

    const targetOnly = targetList
        .filter(l => !sourceNames.has(l.name))
        .map(l => ({ name: l.name, title: l.title || l.name, status: l.status ?? 'unknown' }))

    const blockers = entries.flatMap(e => e.blockers.map(b => ({ ...b, lens: e.name })))
    const ship = entries.filter(e => e.ship)
    const planHash = hashOf({
        source,
        target,
        entries: ship.map(e => ({ name: e.name, hash: e.sourceHash, action: e.action })),
    })

    return {
        source,
        target,
        generatedAt: new Date().toISOString(),
        entries,
        targetOnly,
        blockers,
        errors: { source: sourceList.errors ?? [], target: targetList.errors ?? [] },
        counts: {
            new: entries.filter(e => e.action === 'new').length,
            changed: entries.filter(e => e.action === 'changed').length,
            same: entries.filter(e => e.action === 'same').length,
            drafts: entries.filter(e => e.action === 'draft').length,
            targetOnly: targetOnly.length,
            blockers: blockers.length,
            ship: ship.length,
        },
        deployable: ship.map(e => e.name),
        planHash,
        ok: blockers.length === 0,
    }
}

async function readApprovals(target, { ideToken } = {}) {
    const arr = await store.readOptional(target, AREA, APPROVALS_DOC, { ideToken })
    return Array.isArray(arr) ? arr : []
}

async function readHistory(target, { ideToken } = {}) {
    const arr = await store.readOptional(target, AREA, HISTORY_DOC, { ideToken })
    return Array.isArray(arr) ? arr : []
}

// Record the human decision. The server re-reads the source, so the hashes in
// the approval are always the contents that were actually on the source at
// approval time — a client cannot approve a stale or altered Lens.
async function approveLenses(source, target, opts = {}) {
    if (!source || !target) throw badRequest('source and target required')
    const { ideToken, entries, deletes, note, by, planHash } = opts
    const plan = await planLenses(source, target, { ideToken })

    if (planHash && planHash !== plan.planHash) {
        throw refuse('The source changed since this plan was reviewed — compare again before approving.')
    }
    if (plan.blockers.length) {
        throw refuse(`The plan has blockers: ${plan.blockers.map(b => `${b.lens} ${b.message}`).join('; ')}`)
    }

    const requested = Array.isArray(entries) ? entries.map(String) : plan.deployable
    const byName = new Map(plan.entries.map(e => [e.name, e]))
    const selected = []
    for (const name of requested) {
        const entry = byName.get(name)
        if (!entry) throw refuse(`"${name}" is not a Lens on ${source}.`)
        if (entry.status !== 'published') throw refuse(`"${name}" is a draft on ${source} — only published Lenses can ship.`)
        if (entry.action === 'same') throw refuse(`"${name}" is already the same on ${target} — nothing to ship.`)
        if (entry.action !== 'new' && entry.action !== 'changed') throw refuse(`"${name}" cannot be deployed (${entry.action}).`)
        if (entry.blockers.length) throw refuse(`"${name}" has blockers: ${entry.blockers.map(b => b.message).join('; ')}`)
        selected.push({ name: entry.name, action: entry.action, hash: entry.sourceHash })
    }

    const targetOnlyNames = new Set(plan.targetOnly.map(t => t.name))
    const deleteNames = [...new Set((Array.isArray(deletes) ? deletes : []).map(String))]
    for (const name of deleteNames) {
        if (!targetOnlyNames.has(name)) throw refuse(`"${name}" is not a target-only Lens, so it cannot be deleted.`)
    }

    if (!selected.length && !deleteNames.length) {
        throw refuse('There is nothing to approve — no published new/changed Lenses and no target-only deletes.')
    }

    const rec = {
        id: `lens-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`,
        approved_at: new Date().toISOString(),
        approver: by ?? 'unknown',
        note: note ?? '',
        source,
        target,
        planHash: plan.planHash,
        entries: selected,
        deletes: deleteNames,
    }
    const approvals = await readApprovals(target, { ideToken })
    approvals.push(rec)
    await store.writeDoc(target, AREA, APPROVALS_DOC, approvals, { ideToken })
    return rec
}

// Apply an approval: take the target's deploy lock, re-check the source against
// the approved hashes, save each Lens as published, delete only the approved
// target-only Lenses, read every saved Lens back, and record the result.
async function executeLenses(source, target, opts = {}) {
    if (!source || !target) throw badRequest('source and target required')
    const { ideToken, by, approvalId } = opts
    const approvals = await readApprovals(target, { ideToken })
    const approval = approvalId
        ? approvals.find(a => a.id === approvalId)
        : approvals[approvals.length - 1]
    if (!approval) throw refuse(`No approved Lens deploy for ${target} — approve a plan first.`)
    if (approval.source !== source || approval.target !== target) throw refuse(`Approval ${approval.id} was for ${approval.source} → ${approval.target}, not ${source} → ${target}.`)

    try {
        await lock.acquire(target, { by, ideToken })
    } catch (e) {
        if (!e.refused && !e.status) e.status = 409
        throw e
    }

    const result = {
        ok: true,
        source,
        target,
        approvalId: approval.id,
        approvedBy: approval.approver,
        approvedAt: approval.approved_at,
        approvalNote: approval.note ?? '',
        planHash: approval.planHash,
        at: null,
        by: by ?? approval.approver ?? 'unknown',
        entries: [],
        deletes: [],
        errors: [],
    }

    let releaseError = null
    try {
        const plan = await planLenses(source, target, { ideToken })
        if (plan.planHash !== approval.planHash) {
            throw refuse('The source changed since approval — compare and approve again.')
        }
        if (plan.blockers.length) {
            throw refuse(`The target now has blockers: ${plan.blockers.map(b => `${b.lens} ${b.message}`).join('; ')}`)
        }

        const byName = new Map(plan.entries.map(e => [e.name, e]))
        for (const rec of approval.entries) {
            const entry = byName.get(rec.name)
            if (!entry) throw refuse(`Approved Lens "${rec.name}" no longer exists on ${source}.`)
            if (entry.status !== 'published') throw refuse(`Lens "${rec.name}" is now a draft on ${source}.`)
            if (entry.sourceHash !== rec.hash) throw refuse(`Lens "${rec.name}" changed on ${source} since approval — compare and approve again.`)
            if (entry.blockers.length) throw refuse(`Lens "${rec.name}" has blockers on ${target}: ${entry.blockers.map(b => b.message).join('; ')}`)
        }

        const stillTargetOnly = new Set(plan.targetOnly.map(t => t.name))
        for (const name of approval.deletes) {
            if (!stillTargetOnly.has(name)) throw refuse(`Approved delete "${name}" is no longer target-only on ${target}.`)
        }

        for (const rec of approval.entries) {
            try {
                const src = await lensStore.readLens(source, rec.name, { ideToken })
                await lensStore.saveLens(target, rec.name, src.html, result.by, {
                    publish: true,
                    description: src.description,
                    folder: src.folder,
                    title: src.title,
                    icon: src.icon,
                    color: src.color,
                    image: src.image,
                    config: src.config,
                    ideToken,
                })
                const after = await lensStore.readLens(target, rec.name, { ideToken })
                const verified = lensHash(after) === rec.hash
                result.entries.push({
                    name: rec.name,
                    action: rec.action,
                    hash: rec.hash,
                    ok: verified,
                    verified,
                    error: verified ? null : 'Saved Lens does not match the approved source hash',
                })
                if (!verified) result.ok = false
            } catch (e) {
                result.entries.push({ name: rec.name, action: rec.action, hash: rec.hash, ok: false, verified: false, error: e.message })
                result.ok = false
            }
        }

        for (const name of approval.deletes) {
            try {
                await lensStore.deleteLens(target, name, { ideToken })
                result.deletes.push({ name, ok: true })
            } catch (e) {
                result.deletes.push({ name, ok: false, error: e.message })
                result.ok = false
            }
        }
    } finally {
        const released = await lock.release(target, { ideToken })
        if (!released.ok) releaseError = released.error
    }

    if (releaseError) {
        result.lockReleaseError = releaseError
        result.ok = false
        result.errors.push(`Could not release the deploy lock: ${releaseError}`)
    }

    result.at = new Date().toISOString()
    const history = await readHistory(target, { ideToken })
    history.push(result)
    await store.writeDoc(target, AREA, HISTORY_DOC, history, { ideToken })
    return result
}

module.exports = {
    AREA,
    CONTENT_KEYS,
    canonicalize,
    lensHash,
    planLenses,
    approveLenses,
    executeLenses,
    readApprovals,
    readHistory,
}
