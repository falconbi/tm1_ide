'use strict'

// Fix 2 — whole-dimension changes.
// A bulk import records one log row per element (with before/after and hierarchy),
// so Build Release replays it against Live instead of carrying DEV's whole file.
// A remaining "dimension changed" record can only be carried when the target did
// not change that dimension since its last deploy; otherwise the release stops
// and names the dimension.

const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { execFileSync } = require('child_process')

const resolve = (rel) => require.resolve(path.join(__dirname, '..', rel))
const g = (cwd, ...args) => execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8' })
const W = () => fs.mkdtempSync(path.join(os.tmpdir(), 'whole-dim-wk-'))
const BARE = () => fs.mkdtempSync(path.join(os.tmpdir(), 'whole-dim-bare-'))

function write(w, file, text) {
    const f = path.join(w, file)
    fs.mkdirSync(path.dirname(f), { recursive: true })
    fs.writeFileSync(f, text)
}
function applyChanges(w, changes) {
    for (const [file, text] of Object.entries(changes ?? {})) {
        if (text === null) fs.rmSync(path.join(w, file), { force: true })
        else write(w, file, text)
    }
}
function commitAll(w, msg) {
    g(w, 'add', '-A')
    g(w, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '--allow-empty', '-m', msg)
    return g(w, 'rev-parse', 'HEAD').trim()
}

const realBetterSqlite = require('better-sqlite3')
const bsqPath = require.resolve('better-sqlite3')
require.cache[bsqPath] = { id: bsqPath, filename: bsqPath, loaded: true, exports: function () { return realBetterSqlite(':memory:') } }

const gitStatePath = resolve('core/git-state')
let fakeBase = null
require.cache[gitStatePath] = { id: gitStatePath, filename: gitStatePath, loaded: true, exports: { lastDeployed: () => (fakeBase ? { lastDeployedCommit: fakeBase } : null), recordDeploy: async () => ({ ok: true }), load: () => ({}), FILE: '' } }

const cl = require(path.join(__dirname, '..', 'core', 'change-log'))
const { buildRelease } = require(path.join(__dirname, '..', 'core', 'git-release'))

const DIM = 'D'
const dimFile = `dimensions/${DIM}.json`
const hierFile = `dimensions/${DIM}.hierarchies/${DIM}.json`

const dimDoc = () => JSON.stringify({ '@type': 'Dimension', Name: DIM, 'Hierarchies@Code.links': [`${DIM}.hierarchies/${DIM}.json`] }, null, '\t') + '\n'
const hierDoc = (elements, edges = []) => JSON.stringify({
    '@type': 'Hierarchy', Name: DIM,
    Elements: elements.map(([Name, Type = 'Numeric']) => ({ Name, Type })),
    Edges: edges.map(([ParentName, ComponentName, Weight = 1]) => ({ ParentName, ComponentName, Weight })),
}, null, '\t') + '\n'

function makeRepo({ base = {}, live = {}, dev = {} }) {
    const bare = BARE()
    execFileSync('git', ['init', '-q', '--bare', bare])
    const w = W()
    g(w, 'init', '-q')
    g(w, 'remote', 'add', 'origin', bare)

    applyChanges(w, base)
    const baseCommit = commitAll(w, 'base')
    g(w, 'branch', 'main', baseCommit)
    g(w, 'push', '-q', 'origin', 'main:main')

    g(w, 'checkout', '-q', '-b', 'live-T1', baseCommit)
    applyChanges(w, live)
    commitAll(w, 'target live')
    g(w, 'push', '-q', 'origin', 'HEAD:live-T1')

    g(w, 'checkout', '-q', 'main')
    applyChanges(w, dev)
    const devCommit = commitAll(w, 'dev')
    g(w, 'branch', '-M', 'dev')
    g(w, 'push', '-q', 'origin', 'dev:dev')
    return { bare, base: baseCommit, devCommit, w }
}

function releaseFiles(repo) {
    const vw = W()
    try {
        g(vw, 'init', '-q'); g(vw, 'remote', 'add', 'origin', repo.bare)
        g(vw, 'fetch', '-q', 'origin', 'refs/heads/release-T1:rel')
        const files = g(vw, 'ls-tree', '-r', '--name-only', 'rel').split('\n').filter(Boolean)
        const texts = new Map(files.map(f => [f, g(vw, 'show', `rel:${f}`)]))
        const show = (file) => texts.get(file) ?? g(vw, 'show', `rel:${file}`)
        return { show, json: (file) => JSON.parse(show(file)) }
    } finally { fs.rmSync(vw, { recursive: true, force: true }) }
}

function cleanup(repo) {
    fs.rmSync(repo.bare, { recursive: true, force: true })
    fs.rmSync(repo.w, { recursive: true, force: true })
}

let currentServer = 'DEV-W'
function newSession(name, server) {
    currentServer = server
    return cl.startSession(name, server, 'admin')
}

// ── The bulk import route, with a fake TM1 client that really mutates ─────────

function fakeDimensionClient(dim) {
    let elements = []
    let edges = []
    return {
        async getHierarchies() { return [dim] },
        async getElements() { return elements.map(e => ({ Name: e.name, Type: e.type })) },
        async getEdges() { return edges.map(e => ({ ParentName: e.parent, ComponentName: e.child, Weight: e.weight })) },
        async getElementAttributes() { return [] },
        async bulkSetElements(_dim, rows) {
            for (const r of rows) if (!elements.some(e => e.name === r.name)) elements.push({ name: r.name, type: r.type })
        },
        async addEdge(_dim, parent, child, weight) { edges.push({ parent, child, weight }) },
    }
}

function routeHarness(client) {
    const { register } = require(resolve('routes/dimensions'))
    const handlers = {}
    const app = { get(p, fn) { handlers[p] = fn }, post(p, fn) { handlers[p] = fn }, patch(p, fn) { handlers[p] = fn }, delete(p, fn) { handlers[p] = fn } }
    register(app, {
        cl,
        fail: (res, e) => res.status(500).json({ error: e.message }),
        gateReadOnly: () => true,
        gateWrite: () => true,
        logAttributeValue: () => {},
        makeClient: () => client,
    })
    return handlers
}
function response() {
    return { statusCode: 200, body: null, status(c) { this.statusCode = c; return this }, json(b) { this.body = b; return this } }
}

test('a bulk import of 3 elements records 3 element changes and Build Release applies them to Live', async () => {
    const repo = makeRepo({
        base: { [dimFile]: dimDoc(), [hierFile]: hierDoc([]) },
        dev: { [dimFile]: dimDoc(), [hierFile]: hierDoc([['A'], ['B'], ['C']]) },
    })
    const server = 'DEV-W1'
    try {
        fakeBase = repo.base
        const s = newSession('bulk import', server)
        const handlers = routeHarness(fakeDimensionClient(DIM))
        const res = response()
        await handlers['/api/dimension/bulk-import']({
            body: { server, dimension: DIM, hierarchy: DIM, rows: [{ name: 'A' }, { name: 'B' }, { name: 'C' }] },
            user: 'admin',
        }, res)
        assert.equal(res.statusCode, 200, JSON.stringify(res.body))
        assert.equal(res.body.ok, true, JSON.stringify(res.body))

        const logged = cl.getSessionLog(s.id)
        const added = logged.filter(e => e.object_type === 'dimension' && e.action === 'ELEMENT_ADDED')
        assert.equal(added.length, 3, `expected one record per element: ${JSON.stringify(logged.map(e => e.action))}`)
        assert.ok(!logged.some(e => e.action === 'DIMENSION_UPDATED'), 'the import must not record a whole-dimension change')
        for (const e of added) {
            const after = typeof e.after_state === 'string' ? JSON.parse(e.after_state) : e.after_state
            assert.equal(after.hierarchy, DIM)
            assert.ok(['A', 'B', 'C'].includes(after.element))
        }

        cl.setSessionCommit(s.id, repo.devCommit)
        const r = await buildRelease(s, 'T1', { token: 'x', gitUser: 't', repoUrl: repo.bare, liveAttrsFiles: {} })
        assert.equal(r.ok, true, JSON.stringify(r))
        const rel = releaseFiles(repo)
        const doc = rel.json(hierFile)
        assert.deepEqual(doc.Elements.map(e => e.Name).sort(), ['A', 'B', 'C'])
    } finally { cleanup(repo) }
})

test('a whole record stops when the target changed the dimension', async () => {
    const repo = makeRepo({
        base: { [dimFile]: dimDoc(), [hierFile]: hierDoc([['A'], ['B']]) },
        live: { [hierFile]: hierDoc([['A'], ['B'], ['C']]) },
        dev: { [hierFile]: hierDoc([['A'], ['B'], ['D']]) },
    })
    const server = 'DEV-W2'
    try {
        fakeBase = repo.base
        const s = newSession('whole + target moved', server)
        cl.writeLog({ server, action: 'DIMENSION_UPDATED', objectType: 'dimension', objectName: DIM, detail: 'bulk import of 1 element(s)', user: 'admin' })
        cl.setSessionCommit(s.id, repo.devCommit)

        const r = await buildRelease(s, 'T1', { token: 'x', gitUser: 't', repoUrl: repo.bare, liveAttrsFiles: {} })
        assert.equal(r.ok, false, JSON.stringify(r))
        assert.equal(r.refused, true)
        assert.match(r.error, /target changed D/)
        assert.match(r.error, /recorded per element/)
    } finally { cleanup(repo) }
})

test('a whole record carries DEV’s file when the target did not change the dimension', async () => {
    const repo = makeRepo({
        base: { [dimFile]: dimDoc(), [hierFile]: hierDoc([['A'], ['B']]) },
        dev: { [hierFile]: hierDoc([['A'], ['B'], ['D']]) },
    })
    const server = 'DEV-W3'
    try {
        fakeBase = repo.base
        const s = newSession('whole + target still', server)
        cl.writeLog({ server, action: 'DIMENSION_UPDATED', objectType: 'dimension', objectName: DIM, detail: 'bulk import of 1 element(s)', user: 'admin' })
        cl.setSessionCommit(s.id, repo.devCommit)

        const r = await buildRelease(s, 'T1', { token: 'x', gitUser: 't', repoUrl: repo.bare, liveAttrsFiles: {} })
        assert.equal(r.ok, true, JSON.stringify(r))
        const rel = releaseFiles(repo)
        assert.deepEqual(rel.json(hierFile).Elements.map(e => e.Name).sort(), ['A', 'B', 'D'])
    } finally { cleanup(repo) }
})
