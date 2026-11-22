'use strict'

// "Include this object" at Review must include the WHOLE object. A dimension is its
// own file PLUS one file per hierarchy, and the elements live in the hierarchy files —
// so adding only the first file produced a release that could not remove anything.
// (Found while planning the WFP cut to 500: the cut's two dimensions are unowned by
// the change set because the rebuild predates it.)

const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { execFileSync } = require('child_process')

const resolve = (rel) => require.resolve(path.join(__dirname, '..', rel))
const g = (cwd, ...args) => execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8' })
const W = () => fs.mkdtempSync(path.join(os.tmpdir(), 'add-wk-'))
const BARE = () => fs.mkdtempSync(path.join(os.tmpdir(), 'add-bare-'))
const write = (w, file, text) => {
    const f = path.join(w, file)
    fs.mkdirSync(path.dirname(f), { recursive: true })
    fs.writeFileSync(f, text)
}
const commitAll = (w, msg) => {
    g(w, 'add', '-A')
    g(w, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', msg)
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

const dimJson = (note = '', name = 'D') => JSON.stringify({ '@type': 'Dimension', Name: name, Description: note }, null, '\t') + '\n'
const hierJson = (names, name = 'D') => JSON.stringify({
    '@type': 'Hierarchy', Name: name,
    Elements: names.map(n => ({ '@id': `Dimensions('${name}')/Hierarchies('${name}')/Elements('${n}')`, Name: n, Type: 'Numeric' })),
}, null, '\t') + '\n'

function setupRepo({ name = 'D' } = {}) {
    const bare = BARE()
    execFileSync('git', ['init', '-q', '--bare', bare])
    const w = W()
    g(w, 'init', '-q')
    g(w, 'remote', 'add', 'origin', bare)
    write(w, 'cubes/Keep.rules', '# base\n[] = N:1;\n')
    write(w, `dimensions/${name}.json`, dimJson('full', name))
    write(w, `dimensions/${name}.hierarchies/${name}.json`, hierJson(['A', 'B', 'C'], name))
    const base = commitAll(w, 'base')

    // DEV cut the dimension to one element and also changed a rule it owns.
    write(w, `dimensions/${name}.hierarchies/${name}.json`, hierJson(['A'], name))
    write(w, `dimensions/${name}.json`, dimJson('cut', name))
    write(w, 'cubes/Keep.rules', '# dev\n[] = N:2;\n')
    const devCommit = commitAll(w, 'dev')
    g(w, 'branch', '-M', 'dev')
    g(w, 'push', '-q', 'origin', 'dev:dev')
    return { bare, base, devCommit, w }
}

test('including a dimension includes its hierarchy file too', async () => {
    const repo = setupRepo()
    try {
        fakeBase = repo.base
        const s = cl.startSession('cut', 'DEV-A', 'admin')
        cl.setSessionCommit(s.id, repo.devCommit)
        cl.writeLog({ server: 'DEV-A', action: 'RULES_UPDATED', objectType: 'rules', objectName: 'Keep', user: 'admin' })

        // Without the include: the dimension is left on DEV, listed as unowned.
        const without = await buildRelease(s, 'T1', { token: 'x', gitUser: 't', repoUrl: repo.bare })
        assert.equal(without.ok, true, JSON.stringify(without))
        assert.ok(!without.included.some(i => i.type === 'dimension'))
        assert.ok(without.excluded.some(e => e.type === 'dimension' && e.name === 'D'))

        const withDim = await buildRelease(s, 'T1', {
            token: 'x', gitUser: 't', repoUrl: repo.bare,
            addObjects: [{ type: 'dimension', name: 'D' }],
        })
        assert.equal(withDim.ok, true, JSON.stringify(withDim))
        const dimFiles = withDim.included.filter(i => i.type === 'dimension').map(i => i.file).sort()
        assert.deepEqual(dimFiles, ['dimensions/D.hierarchies/D.json', 'dimensions/D.json'])
        assert.deepEqual(withDim.addedByUser[0].files.sort(), ['dimensions/D.hierarchies/D.json', 'dimensions/D.json'])
    } finally {
        fs.rmSync(repo.bare, { recursive: true, force: true })
        fs.rmSync(repo.w, { recursive: true, force: true })
    }
})

test('including an object owned by another change set is still refused', async () => {
    const repo = setupRepo()
    try {
        fakeBase = repo.base
        const s = cl.startSession('cut', 'DEV-B', 'admin')
        cl.setSessionCommit(s.id, repo.devCommit)
        cl.writeLog({ server: 'DEV-B', action: 'RULES_UPDATED', objectType: 'rules', objectName: 'Keep', user: 'admin' })
        const other = cl.startSession('earlier cut', 'DEV-B', 'samtm1')
        cl.writeLog({ server: 'DEV-B', action: 'DIMENSION_UPDATED', objectType: 'dimension', objectName: 'D', user: 'samtm1' })
        assert.ok(other.id)

        const r = await buildRelease(s, 'T1', {
            token: 'x', gitUser: 't', repoUrl: repo.bare,
            addObjects: [{ type: 'dimension', name: 'D' }],
        })
        assert.equal(r.ok, false)
        assert.match(r.error, /belongs to change set "earlier cut"/)
    } finally {
        fs.rmSync(repo.bare, { recursive: true, force: true })
        fs.rmSync(repo.w, { recursive: true, force: true })
    }
})

test('a change set that already deployed the object does not block including it', async () => {
    // "Release "WFP position-level recalculation" first" was the message — for a set
    // that had already been released. Its version is on the target; the current
    // difference is later work. A dimension of its own, so another test's open set
    // on 'D' does not interfere.
    const repo = setupRepo({ name: 'D2' })
    try {
        fakeBase = repo.base
        const s = cl.startSession('cut', 'DEV-C', 'admin')
        cl.setSessionCommit(s.id, repo.devCommit)
        cl.writeLog({ server: 'DEV-C', action: 'RULES_UPDATED', objectType: 'rules', objectName: 'Keep', user: 'admin' })
        const done = cl.startSession('already released', 'DEV-C', 'samtm1')
        cl.writeLog({ server: 'DEV-C', action: 'DIMENSION_UPDATED', objectType: 'dimension', objectName: 'D2', user: 'samtm1' })
        cl.markSessionDeployed(done.id, 'T1')

        const r = await buildRelease(s, 'T1', {
            token: 'x', gitUser: 't', repoUrl: repo.bare,
            addObjects: [{ type: 'dimension', name: 'D2' }],
        })
        assert.equal(r.ok, true, JSON.stringify(r))
        assert.ok(r.included.some(i => i.type === 'dimension' && i.name === 'D2'))
    } finally {
        fs.rmSync(repo.bare, { recursive: true, force: true })
        fs.rmSync(repo.w, { recursive: true, force: true })
    }
})

test('a change set that owns nothing names what DEV changed anyway, instead of a silent 0', async () => {
    // James's flow: the 500 cut of two dimensions was made outside any change set, so
    // a new set owned nothing, the release shipped only its one chore, and Review
    // reported a loss of 0 — which reads exactly like "nothing to change".
    const repo = setupRepo({ name: 'D3' })
    try {
        fakeBase = repo.base
        const s = cl.startSession('nothing of its own', 'DEV-N', 'admin')
        cl.setSessionCommit(s.id, repo.devCommit)

        const r = await buildRelease(s, 'TN', { token: 'x', gitUser: 't', repoUrl: repo.bare })
        assert.equal(r.noChange, true)
        assert.ok(r.leftOnDev.some(x => x.type === 'dimension' && x.name === 'D3'), JSON.stringify(r.leftOnDev))
        assert.match(r.warnings.join(' '), /DEV differs from TN on D3/)

        // And including it turns the same set into a real release.
        const withDim = await buildRelease(s, 'TN', {
            token: 'x', gitUser: 't', repoUrl: repo.bare,
            addObjects: [{ type: 'dimension', name: 'D3' }],
        })
        assert.equal(withDim.ok, true, JSON.stringify(withDim))
        assert.ok(withDim.included.some(i => i.type === 'dimension' && i.name === 'D3'))
        assert.ok(!withDim.leftOnDev.some(x => x.type === 'dimension' && x.name === 'D3'))
    } finally {
        fs.rmSync(repo.bare, { recursive: true, force: true })
        fs.rmSync(repo.w, { recursive: true, force: true })
    }
})
