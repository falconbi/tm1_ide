'use strict'

// Part G.2/G.3 — alternate hierarchies in a Live-based release.
// A change set's element/edge records carry their hierarchy name, so Build Release
// applies each record to that hierarchy's own file. A hierarchy the change set
// created is carried with its link; one it deleted loses both; one the target
// added stays in Live's index. A pre-fix row with no hierarchy name stops the
// build rather than silently taking Live's file.

const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { execFileSync } = require('child_process')

const resolve = (rel) => require.resolve(path.join(__dirname, '..', rel))
const g = (cwd, ...args) => execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8' })
const W = () => fs.mkdtempSync(path.join(os.tmpdir(), 'hier-wk-'))
const BARE = () => fs.mkdtempSync(path.join(os.tmpdir(), 'hier-bare-'))

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
const hierFile = (h) => `dimensions/${DIM}.hierarchies/${h}.json`

const dimDoc = (links) => JSON.stringify({ '@type': 'Dimension', Name: DIM, 'Hierarchies@Code.links': links }, null, '\t') + '\n'
const hierDoc = (name, elements, edges = []) => JSON.stringify({
    '@type': 'Hierarchy', Name: name,
    Elements: elements.map(([Name, Type = 'Numeric']) => ({ Name, Type })),
    Edges: edges.map(([ParentName, ComponentName, Weight = 1]) => ({ ParentName, ComponentName, Weight })),
}, null, '\t') + '\n'

// base is the target's last deployed commit; live is the target's own later
// commit; dev is the change set's pushed commit. live/dev are deltas on base.
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
        const json = (file) => JSON.parse(show(file))
        return { files, show, json }
    } finally { fs.rmSync(vw, { recursive: true, force: true }) }
}

let currentServer = 'DEV-H'
function newSession(name, server) {
    currentServer = server
    return cl.startSession(name, server, 'admin')
}
function log(s, action, detail, { before, after } = {}) {
    cl.writeLog({ server: currentServer, action, objectType: 'dimension', objectName: DIM, detail, beforeState: before, afterState: after, user: 'admin' })
}
function cleanup(repo) {
    fs.rmSync(repo.bare, { recursive: true, force: true })
    fs.rmSync(repo.w, { recursive: true, force: true })
}

const defaultHierarchy = () => hierDoc(DIM, [['A'], ['B'], ['Total', 'Consolidated']], [['Total', 'A'], ['Total', 'B']])

test('a recorded move in an alternate hierarchy is applied to that hierarchy file', async () => {
    const repo = makeRepo({
        base: {
            [dimFile]: dimDoc([`${DIM}.hierarchies/${DIM}.json`, `${DIM}.hierarchies/Alt.json`]),
            [hierFile(DIM)]: defaultHierarchy(),
            [hierFile('Alt')]: hierDoc('Alt', [['A'], ['B'], ['Total', 'Consolidated']], [['Total', 'A'], ['Total', 'B']]),
        },
        dev: {
            [hierFile('Alt')]: hierDoc('Alt', [['A'], ['B'], ['Total', 'Consolidated']], [['Total', 'A'], ['A', 'B']]),
        },
    })
    try {
        fakeBase = repo.base
        const s = newSession('alt move', 'DEV-H1')
        cl.setSessionCommit(s.id, repo.devCommit)
        log(s, 'ELEMENT_LINKED', 'B under A in Alt', { after: { element: 'B', parent: 'A', weight: 1, hierarchy: 'Alt' } })
        log(s, 'EDGE_REMOVED', 'Total · removed B in Alt', { before: { element: 'B', parent: 'Total', weight: 1, hierarchy: 'Alt' } })

        const r = await buildRelease(s, 'T1', { token: 'x', gitUser: 't', repoUrl: repo.bare, liveAttrsFiles: {} })
        assert.equal(r.ok, true, JSON.stringify(r))
        const rel = releaseFiles(repo)
        const alt = rel.json(hierFile('Alt'))
        assert.ok(alt.Edges.some(e => e.ParentName === 'A' && e.ComponentName === 'B'), 'move applied in the alternate hierarchy')
        assert.ok(!alt.Edges.some(e => e.ParentName === 'Total' && e.ComponentName === 'B'), 'old placement removed')
        assert.ok(alt.Elements.some(e => e.Name === 'A') && alt.Elements.some(e => e.Name === 'B'), 'elements kept')
        const def = rel.json(hierFile(DIM))
        assert.deepEqual(def.Elements.map(e => e.Name).sort(), ['A', 'B', 'Total'])
    } finally { cleanup(repo) }
})

test('a new alternate hierarchy is carried and listed in the dimension index', async () => {
    const repo = makeRepo({
        base: {
            [dimFile]: dimDoc([`${DIM}.hierarchies/${DIM}.json`]),
            [hierFile(DIM)]: defaultHierarchy(),
        },
        dev: {
            [dimFile]: dimDoc([`${DIM}.hierarchies/${DIM}.json`, `${DIM}.hierarchies/NewAlt.json`]),
            [hierFile('NewAlt')]: hierDoc('NewAlt', [['A'], ['B'], ['Total', 'Consolidated']], [['Total', 'A'], ['Total', 'B']]),
        },
    })
    try {
        fakeBase = repo.base
        const s = newSession('new alt', 'DEV-H2')
        cl.setSessionCommit(s.id, repo.devCommit)
        log(s, 'HIERARCHY_CREATED', 'NewAlt', { after: { dimension: DIM, hierarchy: 'NewAlt' } })

        const r = await buildRelease(s, 'T1', { token: 'x', gitUser: 't', repoUrl: repo.bare, liveAttrsFiles: {} })
        assert.equal(r.ok, true, JSON.stringify(r))
        const rel = releaseFiles(repo)
        assert.ok(rel.files.includes(hierFile('NewAlt')), 'new hierarchy file carried from DEV')
        const dim = rel.json(dimFile)
        assert.ok(dim['Hierarchies@Code.links'].includes(`${DIM}.hierarchies/NewAlt.json`), 'link added to Live index')
        assert.ok(dim['Hierarchies@Code.links'].includes(`${DIM}.hierarchies/${DIM}.json`), 'existing default link kept')
    } finally { cleanup(repo) }
})

test('a deleted alternate hierarchy loses its file and its link', async () => {
    const repo = makeRepo({
        base: {
            [dimFile]: dimDoc([`${DIM}.hierarchies/${DIM}.json`, `${DIM}.hierarchies/Gone.json`]),
            [hierFile(DIM)]: defaultHierarchy(),
            [hierFile('Gone')]: hierDoc('Gone', [['A']]),
        },
        dev: {
            [dimFile]: dimDoc([`${DIM}.hierarchies/${DIM}.json`]),
            [hierFile('Gone')]: null,
        },
    })
    try {
        fakeBase = repo.base
        const s = newSession('deleted alt', 'DEV-H3')
        cl.setSessionCommit(s.id, repo.devCommit)
        log(s, 'HIERARCHY_DELETED', 'Gone', { before: { dimension: DIM, hierarchy: 'Gone' } })

        const r = await buildRelease(s, 'T1', { token: 'x', gitUser: 't', repoUrl: repo.bare, liveAttrsFiles: {} })
        assert.equal(r.ok, true, JSON.stringify(r))
        const rel = releaseFiles(repo)
        assert.ok(!rel.files.includes(hierFile('Gone')), 'deleted hierarchy file is not in the release')
        const dim = rel.json(dimFile)
        assert.ok(!dim['Hierarchies@Code.links'].includes(`${DIM}.hierarchies/Gone.json`), 'link removed')
        assert.ok(dim['Hierarchies@Code.links'].includes(`${DIM}.hierarchies/${DIM}.json`), 'default link kept')
    } finally { cleanup(repo) }
})

test('a hierarchy the target added itself stays in Live’s index', async () => {
    const repo = makeRepo({
        base: {
            [dimFile]: dimDoc([`${DIM}.hierarchies/${DIM}.json`]),
            [hierFile(DIM)]: defaultHierarchy(),
        },
        live: {
            [dimFile]: dimDoc([`${DIM}.hierarchies/${DIM}.json`, `${DIM}.hierarchies/TargetAlt.json`]),
            [hierFile('TargetAlt')]: hierDoc('TargetAlt', [['A'], ['B']], [['A', 'B', 0.5]]),
        },
        dev: {
            [dimFile]: dimDoc([`${DIM}.hierarchies/${DIM}.json`, `${DIM}.hierarchies/NewAlt.json`]),
            [hierFile('NewAlt')]: hierDoc('NewAlt', [['A']]),
        },
    })
    try {
        fakeBase = repo.base
        const s = newSession('target alt kept', 'DEV-H4')
        cl.setSessionCommit(s.id, repo.devCommit)
        log(s, 'HIERARCHY_CREATED', 'NewAlt', { after: { dimension: DIM, hierarchy: 'NewAlt' } })

        const r = await buildRelease(s, 'T1', { token: 'x', gitUser: 't', repoUrl: repo.bare, liveAttrsFiles: {} })
        assert.equal(r.ok, true, JSON.stringify(r))
        const rel = releaseFiles(repo)
        const links = rel.json(dimFile)['Hierarchies@Code.links']
        assert.ok(links.includes(`${DIM}.hierarchies/TargetAlt.json`), 'target-added hierarchy stays in Live’s index')
        assert.ok(links.includes(`${DIM}.hierarchies/NewAlt.json`), 'the change set’s new hierarchy is added')
        assert.ok(rel.files.includes(hierFile('TargetAlt')), 'the target hierarchy file is carried from Live so the index is valid')
    } finally { cleanup(repo) }
})

test('a pre-fix record with no hierarchy name stops when that alternate hierarchy changed on DEV', async () => {
    const repo = makeRepo({
        base: {
            [dimFile]: dimDoc([`${DIM}.hierarchies/${DIM}.json`, `${DIM}.hierarchies/Alt.json`]),
            [hierFile(DIM)]: defaultHierarchy(),
            [hierFile('Alt')]: hierDoc('Alt', [['A'], ['B'], ['Total', 'Consolidated']], [['Total', 'A'], ['Total', 'B']]),
        },
        dev: {
            [hierFile('Alt')]: hierDoc('Alt', [['A'], ['B'], ['Total', 'Consolidated']], [['Total', 'A'], ['A', 'B']]),
        },
    })
    try {
        fakeBase = repo.base
        const s = newSession('old row', 'DEV-H5')
        cl.setSessionCommit(s.id, repo.devCommit)
        // An older log entry: state carries no hierarchy at all.
        log(s, 'ELEMENT_LINKED', 'B under A', { after: { element: 'B', parent: 'A', weight: 1 } })
        log(s, 'EDGE_REMOVED', 'Total · removed B', { before: { element: 'B', parent: 'Total', weight: 1 } })

        const r = await buildRelease(s, 'T1', { token: 'x', gitUser: 't', repoUrl: repo.bare, liveAttrsFiles: {} })
        assert.equal(r.ok, false, JSON.stringify(r))
        assert.equal(r.refused, true)
        assert.match(r.error, /Build release stopped for D/)
        assert.match(r.error, /do not name a hierarchy/)
    } finally { cleanup(repo) }
})
