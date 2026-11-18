'use strict'
const { test, beforeEach } = require('node:test')
const assert = require('node:assert/strict')
const path = require('path')

const resolve = rel => require.resolve(path.join(__dirname, '..', rel))

// The Lens deploy reads Lenses through lens-store and its approvals/history
// through model-store. Stub both so the whole flow runs offline, plus the target
// client (cubes/processes) and the deploy lock.
const lenses = new Map()        // `${server}|${name}` -> document
const docs = new Map()          // `${server}|${area}|${name}` -> data
const clients = new Map()       // server -> { getModelCubes, getProcesses }
const lockCalls = { acquire: [], release: [] }
let lockHeld = false

const lensStorePath = resolve('core/lens-store.js')
require.cache[lensStorePath] = {
    id: lensStorePath, filename: lensStorePath, loaded: true,
    exports: {
        async listLenses(server) {
            const out = []
            out.errors = []
            for (const [key, doc] of lenses) {
                const [srv] = key.split('|')
                if (srv !== server) continue
                const { html: _html, ...details } = doc
                out.push(details)
            }
            return out.sort((a, b) => String(a.name).localeCompare(String(b.name)))
        },
        async readLens(server, name) {
            const doc = lenses.get(`${server}|${name}`)
            if (!doc) throw new Error(`Lens "${name}" not found on ${server}`)
            return JSON.parse(JSON.stringify(doc))
        },
        async saveLens(server, name, html, owner, opts = {}) {
            const key = `${server}|${name}`
            const existing = lenses.get(key)
            const now = new Date().toISOString()
            const doc = {
                name,
                status: opts.publish === true ? 'published' : opts.publish === false ? 'draft' : (existing?.status ?? 'draft'),
                owner: owner ?? 'unknown',
                version: (Number(existing?.version) || 0) + 1,
                updated: now,
                description: opts.description ?? existing?.description ?? '',
                folder: opts.folder ?? existing?.folder ?? '',
                title: opts.title ?? existing?.title ?? '',
                icon: opts.icon ?? existing?.icon ?? '',
                color: opts.color ?? existing?.color ?? '',
                image: opts.image ?? existing?.image ?? '',
                config: opts.config ?? existing?.config ?? {},
                created: existing?.created ?? now,
                createdBy: existing?.createdBy ?? owner ?? 'unknown',
                toolkitVersion: 12,
                html,
            }
            lenses.set(key, doc)
            const { html: _html, ...details } = doc
            return details
        },
        async deleteLens(server, name) {
            const key = `${server}|${name}`
            if (!lenses.has(key)) throw new Error(`Lens "${name}" not found on ${server}`)
            lenses.delete(key)
        },
    },
}

const storePath = resolve('core/model-store.js')
require.cache[storePath] = {
    id: storePath, filename: storePath, loaded: true,
    exports: {
        async readOptional(server, area, name) {
            return docs.get(`${server}|${area}|${name}`) ?? null
        },
        async readDoc(server, area, name) {
            return docs.get(`${server}|${area}|${name}`) ?? null
        },
        async writeDoc(server, area, name, data) {
            docs.set(`${server}|${area}|${name}`, JSON.parse(JSON.stringify(data)))
            return data
        },
        async listDocs(server, area) {
            return [...docs.keys()].filter(k => k.startsWith(`${server}|${area}|`)).map(k => k.split('|')[2])
        },
    },
}

const arPath = resolve('core/adapter-registry.js')
require.cache[arPath] = {
    id: arPath, filename: arPath, loaded: true,
    exports: { makeClient: server => clients.get(server) },
}

const lockPath = resolve('core/git-lock.js')
require.cache[lockPath] = {
    id: lockPath, filename: lockPath, loaded: true,
    exports: {
        async acquire(target, opts) {
            lockCalls.acquire.push({ target, by: opts?.by })
            if (lockHeld) { const e = new Error('busy'); e.refused = true; throw e }
            lockHeld = true
            return { by: opts?.by }
        },
        async release(target) {
            lockCalls.release.push({ target })
            lockHeld = false
            return { ok: true }
        },
    },
}

delete require.cache[resolve('core/lens-deploy')]
const lensDeploy = require(resolve('core/lens-deploy'))

function lens(server, name, html, opts = {}) {
    const key = `${server}|${name}`
    const existing = lenses.get(key)
    const doc = {
        name,
        status: opts.status ?? existing?.status ?? 'published',
        owner: opts.owner ?? 'admin',
        version: opts.version ?? ((existing?.version ?? 0) + 1),
        updated: opts.updated ?? '2026-01-01T00:00:00.000Z',
        description: opts.description ?? '',
        folder: opts.folder ?? '',
        title: opts.title ?? name,
        icon: opts.icon ?? '',
        color: opts.color ?? '',
        image: opts.image ?? '',
        config: opts.config ?? {},
        created: opts.created ?? '2026-01-01T00:00:00.000Z',
        createdBy: opts.createdBy ?? 'admin',
        toolkitVersion: 12,
        html,
    }
    lenses.set(key, doc)
    return doc
}

function resources(server, { cubes = [], processes = [] } = {}) {
    clients.set(server, {
        async getModelCubes() { return cubes },
        async getProcesses() { return processes },
    })
}

beforeEach(() => {
    lenses.clear()
    docs.clear()
    clients.clear()
    lockCalls.acquire.length = 0
    lockCalls.release.length = 0
    lockHeld = false
    resources('SRC', { cubes: ['Sales'], processes: ['Load Sales'] })
    resources('TGT', { cubes: ['Sales'], processes: ['Load Sales'] })
})

test('plan reports new, changed, same and drafts, and target-only Lenses', async () => {
    lens('SRC', 'New-Lens', '<p>new</p>', { title: 'New Lens' })
    lens('SRC', 'Changed-Lens', '<p>v2</p>')
    lens('SRC', 'Same-Lens', '<p>same</p>')
    lens('SRC', 'Draft-Lens', '<p>draft</p>', { status: 'draft' })

    lens('TGT', 'Changed-Lens', '<p>v1</p>')
    lens('TGT', 'Same-Lens', '<p>same</p>')
    lens('TGT', 'Target-Only', '<p>old</p>')

    const plan = await lensDeploy.planLenses('SRC', 'TGT')
    const byName = new Map(plan.entries.map(e => [e.name, e]))

    assert.equal(byName.get('New-Lens').action, 'new')
    assert.equal(byName.get('Changed-Lens').action, 'changed')
    assert.equal(byName.get('Same-Lens').action, 'same')
    assert.equal(byName.get('Draft-Lens').action, 'draft')
    assert.equal(byName.get('Draft-Lens').enabled, false)
    assert.deepEqual(plan.deployable.sort(), ['Changed-Lens', 'New-Lens'])
    assert.deepEqual(plan.targetOnly.map(t => t.name), ['Target-Only'])
    assert.deepEqual(plan.counts, { new: 1, changed: 1, same: 1, drafts: 1, targetOnly: 1, blockers: 0, ship: 2 })
    assert.equal(plan.ok, true)
    assert.match(plan.planHash, /^[a-f0-9]{64}$/)
})

test('a Lens whose config writes/runs miss the target is a blocker, not a warning', async () => {
    lens('SRC', 'Blocked-Lens', '<p>blocked</p>', {
        config: { writes: ['Missing Cube'], runs: ['Missing Process'] },
    })

    const plan = await lensDeploy.planLenses('SRC', 'TGT')
    const entry = plan.entries.find(e => e.name === 'Blocked-Lens')

    assert.equal(entry.ship, false)
    assert.equal(entry.enabled, false)
    assert.deepEqual(entry.blockers.map(b => `${b.kind}:${b.name}`), ['cube:Missing Cube', 'process:Missing Process'])
    assert.equal(plan.ok, false)
    assert.equal(plan.counts.blockers, 2)
    await assert.rejects(() => lensDeploy.approveLenses('SRC', 'TGT', { by: 'admin' }), /blockers/i)
})

test('the content hash ignores deployment bookkeeping but changes with the code', () => {
    const base = {
        name: 'L', status: 'published', html: '<p>one</p>', description: '', folder: '', title: 'L',
        icon: '', color: '', image: '', config: { a: 1, b: 2 }, version: 1,
        updated: '2026-01-01T00:00:00.000Z', owner: 'one', created: '2026-01-01T00:00:00.000Z', createdBy: 'one',
    }
    const same = { ...base, version: 9, updated: '2026-02-02T00:00:00.000Z', owner: 'two', created: '2020-01-01T00:00:00.000Z', createdBy: 'two', config: { b: 2, a: 1 } }
    assert.equal(lensDeploy.lensHash(base), lensDeploy.lensHash(same))
    assert.notEqual(lensDeploy.lensHash(base), lensDeploy.lensHash({ ...base, html: '<p>two</p>' }))
})

test('approve records the exact source hashes, then execute ships, verifies, deletes and records history', async () => {
    lens('SRC', 'Sales-Input', '<p>v2</p>', { title: 'Enter sales', config: { writes: ['Sales'] } })
    lens('SRC', 'New-Lens', '<p>new</p>')
    lens('TGT', 'Sales-Input', '<p>v1</p>')
    lens('TGT', 'Old-Lens', '<p>old</p>')

    const plan = await lensDeploy.planLenses('SRC', 'TGT')
    const approval = await lensDeploy.approveLenses('SRC', 'TGT', {
        by: 'admin', note: 'quarterly update', planHash: plan.planHash, deletes: ['Old-Lens'],
    })

    assert.equal(approval.approver, 'admin')
    assert.equal(approval.note, 'quarterly update')
    assert.equal(approval.planHash, plan.planHash)
    assert.deepEqual(approval.entries.map(e => e.name).sort(), ['New-Lens', 'Sales-Input'])
    assert.deepEqual(approval.deletes, ['Old-Lens'])
    for (const entry of approval.entries) {
        const source = JSON.parse(JSON.stringify(lenses.get(`SRC|${entry.name}`)))
        assert.equal(entry.hash, lensDeploy.lensHash(source))
    }

    const result = await lensDeploy.executeLenses('SRC', 'TGT', { by: 'admin', approvalId: approval.id })

    assert.equal(result.ok, true, JSON.stringify(result.errors))
    assert.deepEqual(result.entries.map(e => e.name).sort(), ['New-Lens', 'Sales-Input'])
    assert.ok(result.entries.every(e => e.ok && e.verified))
    assert.deepEqual(result.deletes, [{ name: 'Old-Lens', ok: true }])
    assert.equal(lenses.has('TGT|Old-Lens'), false)

    const saved = lenses.get('TGT|Sales-Input')
    assert.equal(saved.status, 'published')
    assert.equal(saved.html, '<p>v2</p>')
    assert.equal(saved.title, 'Enter sales')
    assert.equal(lensDeploy.lensHash(saved), approval.entries.find(e => e.name === 'Sales-Input').hash)

    const history = await lensDeploy.readHistory('TGT')
    assert.equal(history.length, 1)
    assert.equal(history[0].source, 'SRC')
    assert.equal(history[0].target, 'TGT')
    assert.equal(history[0].by, 'admin')
    assert.equal(history[0].approvedBy, 'admin')
    assert.equal(history[0].entries.length, 2)
    assert.equal(history[0].deletes[0].name, 'Old-Lens')

    const approvals = await lensDeploy.readApprovals('TGT')
    assert.equal(approvals.length, 1)
    assert.equal(lockCalls.acquire.length, 1)
    assert.equal(lockCalls.acquire[0].target, 'TGT')
    assert.equal(lockCalls.release.length, 1)
})

test('execute refuses when the source changes after approval', async () => {
    lens('SRC', 'Sales-Input', '<p>v2</p>')
    lens('TGT', 'Sales-Input', '<p>v1</p>')

    const plan = await lensDeploy.planLenses('SRC', 'TGT')
    const approval = await lensDeploy.approveLenses('SRC', 'TGT', { by: 'admin', planHash: plan.planHash })

    lens('SRC', 'Sales-Input', '<p>v3 changed after approval</p>')

    await assert.rejects(
        () => lensDeploy.executeLenses('SRC', 'TGT', { by: 'admin', approvalId: approval.id }),
        /source changed since approval/i,
    )
    assert.equal(lenses.get('TGT|Sales-Input').html, '<p>v1</p>', 'the target was not touched')
    assert.equal(lockCalls.release.length, 1, 'the lock was released on refusal')
    const history = await lensDeploy.readHistory('TGT')
    assert.equal(history.length, 0, 'a refused deploy is not recorded as a deploy')
})

test('a draft Lens is listed but cannot be approved or shipped', async () => {
    lens('SRC', 'Draft-Lens', '<p>draft</p>', { status: 'draft' })
    const plan = await lensDeploy.planLenses('SRC', 'TGT')
    assert.equal(plan.entries[0].action, 'draft')
    assert.deepEqual(plan.deployable, [])
    await assert.rejects(() => lensDeploy.approveLenses('SRC', 'TGT', { by: 'admin', entries: ['Draft-Lens'] }), /draft/i)
})
