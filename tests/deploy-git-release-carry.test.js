'use strict'

// A change set that does not touch a dimension must not undo the target's own
// changes to it. The release tree starts from the target's live copy for data
// objects, so the pull has nothing to roll back. Code (rules, processes, cubes)
// is still not carried.

const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { execFileSync } = require('child_process')

const resolve = (rel) => require.resolve(path.join(__dirname, '..', rel))
const g = (cwd, ...a) => execFileSync('git', ['-C', cwd, ...a], { encoding: 'utf8' })
const W = () => fs.mkdtempSync(path.join(os.tmpdir(), 'carry-wk-'))
const BARE = () => fs.mkdtempSync(path.join(os.tmpdir(), 'carry-bare-'))
const write = (w, f, t) => { const p = path.join(w, f); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, t) }
const commitAll = (w, m) => { g(w, 'add', '-A'); g(w, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', m); return g(w, 'rev-parse', 'HEAD').trim() }

const realBetterSqlite = require('better-sqlite3')
const bsqPath = require.resolve('better-sqlite3')
require.cache[bsqPath] = { id: bsqPath, filename: bsqPath, loaded: true, exports: function () { return realBetterSqlite(':memory:') } }

const gitStatePath = resolve('core/git-state')
let fakeBase = null
require.cache[gitStatePath] = { id: gitStatePath, filename: gitStatePath, loaded: true, exports: { lastDeployed: () => (fakeBase ? { lastDeployedCommit: fakeBase } : null), recordDeploy: async () => ({ ok: true }), load: () => ({}), FILE: '' } }

const cl = require(path.join(__dirname, '..', 'core', 'change-log'))
const { buildRelease } = require(path.join(__dirname, '..', 'core', 'git-release'))

const hier = (names) => JSON.stringify({
    '@type': 'Hierarchy', Name: 'Employee',
    Elements: names.map(n => ({ Name: n, Type: 'Numeric' })), Edges: [],
}, null, '\t') + '\n'
const dimDoc = () => JSON.stringify({ '@type': 'Dimension', Name: 'Employee', 'Hierarchies@Code.links': ['Employee.hierarchies/Employee.json'] }, null, '\t') + '\n'

function setupRepo() {
    const bare = BARE()
    execFileSync('git', ['init', '-q', '--bare', bare])
    const w = W()
    g(w, 'init', '-q'); g(w, 'remote', 'add', 'origin', bare)

    write(w, 'dimensions/Employee.json', dimDoc())
    write(w, 'dimensions/Employee.hierarchies/Employee.json', hier(['A', 'B']))
    write(w, 'processes/Work.json', JSON.stringify({ Name: 'Work' }))
    write(w, 'processes/Work.ti', '# base\n')
    const base = commitAll(w, 'base')
    g(w, 'branch', 'main', base); g(w, 'push', '-q', 'origin', 'main:main')

    // The target's own load added an element to a dimension the set never touches.
    write(w, 'dimensions/Employee.hierarchies/Employee.json', hier(['A', 'B', 'LOADED']))
    commitAll(w, 'target live')
    g(w, 'push', '-q', 'origin', 'HEAD:live-TC')
    g(w, 'checkout', '-q', 'main')

    // DEV changes only the process.
    write(w, 'processes/Work.ti', '# changed on DEV\n')
    const dev = commitAll(w, 'dev change')
    g(w, 'branch', 'dev', dev); g(w, 'push', '-q', 'origin', 'dev:dev')
    return { bare, base, dev, w }
}

test('the target’s own element survives a release that does not mention its dimension', async () => {
    const r = setupRepo()
    try {
        fakeBase = r.base
        const s = cl.startSession('Process only', 'DEV1', 'admin')
        cl.setSessionCommit(s.id, r.dev)
        cl.writeLog({ server: 'DEV1', action: 'PROCESS_SAVED', objectType: 'process', objectName: 'Work', user: 'admin' })

        const out = await buildRelease(s, 'TC', { token: 'x', gitUser: 't', repoUrl: r.bare })
        assert.equal(out.ok, true, JSON.stringify(out).slice(0, 500))

        const vw = W()
        try {
            g(vw, 'init', '-q'); g(vw, 'remote', 'add', 'origin', r.bare)
            g(vw, 'fetch', '-q', 'origin', 'refs/heads/release-TC:rel')
            const doc = JSON.parse(g(vw, 'show', 'rel:dimensions/Employee.hierarchies/Employee.json'))
            const names = doc.Elements.map(e => e.Name)
            assert.ok(names.includes('LOADED'), `target element dropped from the release: ${names.join(',')}`)
            const ti = g(vw, 'show', 'rel:processes/Work.ti')
            assert.match(ti, /changed on DEV/, 'the change set still ships')
        } finally { fs.rmSync(vw, { recursive: true, force: true }) }
    } finally { fs.rmSync(r.bare, { recursive: true, force: true }); fs.rmSync(r.w, { recursive: true, force: true }) }
})

test('a rule the target changed is NOT carried — it must block instead', async () => {
    const bare = BARE()
    const w = W()
    try {
        execFileSync('git', ['init', '-q', '--bare', bare])
        g(w, 'init', '-q'); g(w, 'remote', 'add', 'origin', bare)
        write(w, 'cubes/Sales.json', JSON.stringify({ Name: 'Sales' }))
        write(w, 'cubes/Sales.rules', '# base\n')
        write(w, 'processes/Work.json', JSON.stringify({ Name: 'Work' }))
        const base = commitAll(w, 'base')
        g(w, 'branch', 'main', base); g(w, 'push', '-q', 'origin', 'main:main')
        // Target hand-edited the rules.
        write(w, 'cubes/Sales.rules', '# edited on the target\n')
        commitAll(w, 'target rules'); g(w, 'push', '-q', 'origin', 'HEAD:live-TR'); g(w, 'checkout', '-q', 'main')
        write(w, 'processes/Work.json', JSON.stringify({ Name: 'Work', changed: true }))
        const dev = commitAll(w, 'dev')
        g(w, 'branch', 'dev', dev); g(w, 'push', '-q', 'origin', 'dev:dev')

        fakeBase = base
        const s = cl.startSession('Process only 2', 'DEV1', 'admin')
        cl.setSessionCommit(s.id, dev)
        cl.writeLog({ server: 'DEV1', action: 'PROCESS_SAVED', objectType: 'process', objectName: 'Work', user: 'admin' })
        const out = await buildRelease(s, 'TR', { token: 'x', gitUser: 't', repoUrl: bare })
        if (out.ok) {
            assert.ok(!(out.carriedFromTarget ?? []).some(f => /\.rules$/.test(f)),
                `a rule was carried silently: ${JSON.stringify(out.carriedFromTarget)}`)
        }
    } finally { fs.rmSync(bare, { recursive: true, force: true }); fs.rmSync(w, { recursive: true, force: true }) }
})
