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

const dimJson = (note = '') => JSON.stringify({ '@type': 'Dimension', Name: 'D', Description: note }, null, '\t') + '\n'
const hierJson = (names) => JSON.stringify({
    '@type': 'Hierarchy', Name: 'D',
    Elements: names.map(n => ({ '@id': `Dimensions('D')/Hierarchies('D')/Elements('${n}')`, Name: n, Type: 'Numeric' })),
}, null, '\t') + '\n'

function setupRepo() {
    const bare = BARE()
    execFileSync('git', ['init', '-q', '--bare', bare])
    const w = W()
    g(w, 'init', '-q')
    g(w, 'remote', 'add', 'origin', bare)
    write(w, 'cubes/Keep.rules', '# base\n[] = N:1;\n')
    write(w, 'dimensions/D.json', dimJson('full'))
    write(w, 'dimensions/D.hierarchies/D.json', hierJson(['A', 'B', 'C']))
    const base = commitAll(w, 'base')

    // DEV cut the dimension to one element and also changed a rule it owns.
    write(w, 'dimensions/D.hierarchies/D.json', hierJson(['A']))
    write(w, 'dimensions/D.json', dimJson('cut'))
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
        const s = cl.startSession('cut', 'DEV1', 'admin')
        cl.setSessionCommit(s.id, repo.devCommit)
        cl.writeLog({ server: 'DEV1', action: 'RULES_UPDATED', objectType: 'rules', objectName: 'Keep', user: 'admin' })

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
        const s = cl.startSession('cut', 'DEV1', 'admin')
        cl.setSessionCommit(s.id, repo.devCommit)
        cl.writeLog({ server: 'DEV1', action: 'RULES_UPDATED', objectType: 'rules', objectName: 'Keep', user: 'admin' })
        const other = cl.startSession('earlier cut', 'DEV1', 'samtm1')
        cl.writeLog({ server: 'DEV1', action: 'DIMENSION_UPDATED', objectType: 'dimension', objectName: 'D', user: 'samtm1' })
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
