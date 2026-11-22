'use strict'

// Two things a view needs that a release used to miss:
//   1. A view lives in the CUBE's file (`Views@Code.links`), so adding or removing a
//      view changes `cubes/<cube>.json` as well. Shipping the view without the cube
//      file left the target's cube file stale — drift reported it as modified and
//      paused every later deploy.
//   2. An MDX view is TWO files (.json + .mdx). Handing the .mdx text to the applier
//      meant JSON.parse on MDX, which threw: the deploy reported an error and called
//      the view incomplete after applying it correctly.

const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { execFileSync } = require('child_process')

const resolve = (rel) => require.resolve(path.join(__dirname, '..', rel))
const g = (cwd, ...args) => execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8' })
const W = () => fs.mkdtempSync(path.join(os.tmpdir(), 'vw-wk-'))
const BARE = () => fs.mkdtempSync(path.join(os.tmpdir(), 'vw-bare-'))
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

// In-memory change log, like the other release tests.
const realBetterSqlite = require('better-sqlite3')
const bsqPath = require.resolve('better-sqlite3')
require.cache[bsqPath] = { id: bsqPath, filename: bsqPath, loaded: true, exports: function () { return realBetterSqlite(':memory:') } }

const gitStatePath = resolve('core/git-state')
let fakeBase = null
require.cache[gitStatePath] = { id: gitStatePath, filename: gitStatePath, loaded: true, exports: { lastDeployed: () => (fakeBase ? { lastDeployedCommit: fakeBase } : null), recordDeploy: async () => ({ ok: true }), load: () => ({}), FILE: '' } }

const cl = require(path.join(__dirname, '..', 'core', 'change-log'))
const { buildRelease, cubeDiffBeyondViews, releasableCovers } = require(path.join(__dirname, '..', 'core', 'git-release'))

const cubeJson = (viewFiles, extra = {}) => JSON.stringify({
    '@type': 'Cube',
    Name: 'C',
    Dimensions: [{ '@id': "Dimensions('D')" }],
    'Rules@Code.link': 'C.rules',
    'Views@Code.links': viewFiles,
    ...extra,
}, null, '\t') + '\n'

function setupRepo({ devCubeExtra = {} } = {}) {
    const bare = BARE()
    execFileSync('git', ['init', '-q', '--bare', bare])
    const w = W()
    g(w, 'init', '-q')
    g(w, 'remote', 'add', 'origin', bare)
    write(w, 'cubes/C.json', cubeJson(['C.views/V1.json']))
    write(w, 'cubes/C.rules', '# base rule\n[] = N:1;\n')
    write(w, 'cubes/C.views/V1.json', '{"@type":"NativeView","Name":"V1"}\n')
    const base = commitAll(w, 'base')

    // DEV adds a view: its file, its MDX sibling, and the cube's view list.
    write(w, 'cubes/C.views/V2.json', '{"@type":"MDXView","Name":"V2","MDX@Code.link":"V2.mdx"}\n')
    write(w, 'cubes/C.views/V2.mdx', 'SELECT 1 ON 0 FROM [C]\n')
    write(w, 'cubes/C.json', cubeJson(['C.views/V1.json', 'C.views/V2.json'], devCubeExtra))
    const devCommit = commitAll(w, 'dev adds a view')
    g(w, 'branch', '-M', 'dev')
    g(w, 'push', '-q', 'origin', 'dev:dev')
    return { bare, base, devCommit, w }
}

test('a view brings its cube file with it (the cube lists its views)', async () => {
    const repo = setupRepo()
    try {
        fakeBase = repo.base
        const s = cl.startSession('add a view', 'DEV1', 'admin')
        cl.setSessionCommit(s.id, repo.devCommit)
        cl.writeLog({ server: 'DEV1', action: 'VIEW_SAVED', objectType: 'view', objectName: 'V2', detail: 'C', user: 'admin' })

        const r = await buildRelease(s, 'T1', { token: 'x', gitUser: 't', repoUrl: repo.bare })
        assert.equal(r.ok, true, JSON.stringify(r))
        const inc = r.included.map(i => `${i.type}:${i.name}`)
        assert.ok(inc.includes('view:V2'), inc.join(', '))
        assert.ok(inc.includes('cube:C'), `the cube file must ship with its view: ${inc.join(', ')}`)
        const dep = (r.dependencies ?? r.addedAsDependency ?? []).find(d => d.type === 'cube' && d.name === 'C')
        if (dep) assert.match(dep.neededBy, /lists its views/)
    } finally {
        fs.rmSync(repo.bare, { recursive: true, force: true })
        fs.rmSync(repo.w, { recursive: true, force: true })
    }
})

test('a cube that changed beyond its view list is refused, not shipped unreviewed', async () => {
    const repo = setupRepo({ devCubeExtra: { Dimensions: [{ '@id': "Dimensions('D')" }, { '@id': "Dimensions('E')" }] } })
    try {
        fakeBase = repo.base
        const s = cl.startSession('add a view', 'DEV1', 'admin')
        cl.setSessionCommit(s.id, repo.devCommit)
        cl.writeLog({ server: 'DEV1', action: 'VIEW_SAVED', objectType: 'view', objectName: 'V2', detail: 'C', user: 'admin' })

        const r = await buildRelease(s, 'T1', { token: 'x', gitUser: 't', repoUrl: repo.bare })
        assert.equal(r.ok, false)
        assert.equal(r.refused, true)
        assert.match(r.error, /C has other changes on DEV/)
        assert.match(r.error, /Dimensions/)
    } finally {
        fs.rmSync(repo.bare, { recursive: true, force: true })
        fs.rmSync(repo.w, { recursive: true, force: true })
    }
})

test('cubeDiffBeyondViews ignores only the view list', () => {
    const a = { Name: 'C', 'Views@Code.links': ['x.json'], Dimensions: [1] }
    const b = { Name: 'C', 'Views@Code.links': ['x.json', 'y.json'], Dimensions: [1] }
    assert.equal(cubeDiffBeyondViews(a, b).differs, false)
    assert.deepEqual(cubeDiffBeyondViews(a, { ...b, Dimensions: [2] }).fields, ['Dimensions'])
})

test('releasableCovers takes the .json of a view, never its .mdx text or a deletion', () => {
    const covers = releasableCovers([
        { action: 'A', file: 'cubes/C.views/V2.json' },
        { action: 'A', file: 'cubes/C.views/V2.mdx' },
        { action: 'D', file: 'cubes/C.views/Gone.json' },
        { action: 'A', file: 'dimensions/D.hierarchies/D.subsets/S.json' },
    ])
    assert.deepEqual(covers.map(x => x.ch.file), ['cubes/C.views/V2.json', 'dimensions/D.hierarchies/D.subsets/S.json'])
    assert.equal(covers[0].obj.type, 'view')
    assert.equal(covers[1].obj.type, 'subset')
})
