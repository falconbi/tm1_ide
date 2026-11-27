'use strict'

// Part G — Build Release from the target's Live plus this change set's records.
// The worked example: PROD loaded 40 employees and promoted Sarah while the change
// set was being tested; the release keeps them and applies only the record.

const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { execFileSync } = require('child_process')

const resolve = (rel) => require.resolve(path.join(__dirname, '..', rel))
const g = (cwd, ...args) => execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8' })
const W = () => fs.mkdtempSync(path.join(os.tmpdir(), 'live-wk-'))
const BARE = () => fs.mkdtempSync(path.join(os.tmpdir(), 'live-bare-'))

function write(w, file, text) {
    const f = path.join(w, file)
    fs.mkdirSync(path.dirname(f), { recursive: true })
    fs.writeFileSync(f, text)
}
function commitAll(w, msg) {
    g(w, 'add', '-A')
    g(w, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', msg)
    return g(w, 'rev-parse', 'HEAD').trim()
}

// In-memory change log
const realBetterSqlite = require('better-sqlite3')
const bsqPath = require.resolve('better-sqlite3')
require.cache[bsqPath] = { id: bsqPath, filename: bsqPath, loaded: true, exports: function () { return realBetterSqlite(':memory:') } }

const gitStatePath = resolve('core/git-state')
let fakeBase = null
require.cache[gitStatePath] = { id: gitStatePath, filename: gitStatePath, loaded: true, exports: { lastDeployed: () => (fakeBase ? { lastDeployedCommit: fakeBase } : null), recordDeploy: async () => ({ ok: true }), load: () => ({}), FILE: '' } }

const cl = require(path.join(__dirname, '..', 'core', 'change-log'))
const { buildRelease } = require(path.join(__dirname, '..', 'core', 'git-release'))
const {
    applyDimensionChanges, applyChoreChanges, planAttributeChanges,
    checkWrittenHierarchy, elementName, edgeParent, edgeChild,
} = require(path.join(__dirname, '..', 'core', 'release-live'))

const hier = (elements, edges = []) => JSON.stringify({
    '@type': 'Hierarchy', Name: 'Employee',
    Elements: elements.map(e => ({ Name: e[0], Type: e[1] })),
    Edges: edges.map(([ParentName, ComponentName, Weight]) => ({ ParentName, ComponentName, Weight })),
}, null, '\t') + '\n'
const dim = (links) => JSON.stringify({ '@type': 'Dimension', Name: 'Employee', 'Hierarchies@Code.links': links }, null, '\t') + '\n'
const subset = (name, members) => JSON.stringify({
    Name: name,
    Elements: members.map(n => ({ '@id': `Dimensions('Employee')/Hierarchies('Employee')/Elements('${n}')`, Name: n })),
}, null, '\t') + '\n'

// base (Last Deployed): A, B, Z; live (target): A, B, X (target removed Z, added X);
// dev: A, B, Y (change set adds Y, moves B under A, removes Z? no — target removed Z).
function setupRepo() {
    const bare = BARE()
    execFileSync('git', ['init', '-q', '--bare', bare])
    const w = W()
    g(w, 'init', '-q')
    g(w, 'remote', 'add', 'origin', bare)

    write(w, 'dimensions/Employee.json', dim(['Employee.hierarchies/Employee.json']))
    write(w, 'dimensions/Employee.hierarchies/Employee.json', hier([['A', 'Numeric'], ['B', 'Numeric'], ['Z', 'Numeric'], ['Group', 'Consolidated']], [['Group', 'A', 1], ['Group', 'B', 1]]))
    write(w, 'dimensions/Employee.hierarchies/Employee.subsets/Default.json', subset('Default', ['A', 'B', 'Z']))
    const base = commitAll(w, 'base')
    g(w, 'branch', 'main', base)
    g(w, 'push', '-q', 'origin', 'main:main')

    // The target's own load: X added, Z removed, subset follows.
    write(w, 'dimensions/Employee.hierarchies/Employee.json', hier([['A', 'Numeric'], ['B', 'Numeric'], ['X', 'Numeric'], ['Group', 'Consolidated']], [['Group', 'A', 1], ['Group', 'B', 1]]))
    write(w, 'dimensions/Employee.hierarchies/Employee.subsets/Default.json', subset('Default', ['A', 'B', 'X']))
    write(w, 'chores/Nightly.json', JSON.stringify({ Name: 'Nightly', StartTime: '22:00', Frequency: 'D', ExecutionMode: 'SingleCommit', Active: true }))
    commitAll(w, 'target live')
    g(w, 'push', '-q', 'origin', 'HEAD:live-T1')
    g(w, 'checkout', '-q', 'main')

    // DEV After Close: Y added, B moved under A, plus a colleague's unfinished K
    // (not in this change set) and Z still present.
    write(w, 'dimensions/Employee.hierarchies/Employee.json', hier([
        ['A', 'Numeric'], ['B', 'Numeric'], ['Y', 'Numeric'], ['Z', 'Numeric'], ['K', 'Numeric'], ['Group', 'Consolidated'],
    ], [['Group', 'A', 1], ['A', 'B', 1]]))
    write(w, 'dimensions/Employee.hierarchies/Employee.subsets/Default.json', subset('Default', ['A', 'B', 'Y', 'Z']))
    write(w, 'chores/Nightly.json', JSON.stringify({ Name: 'Nightly', StartTime: '21:00', Frequency: 'D', ExecutionMode: 'SingleCommit', Active: true }))
    const devCommit = commitAll(w, 'dev')
    g(w, 'branch', '-M', 'dev')
    g(w, 'push', '-q', 'origin', 'dev:dev')
    return { bare, base, devCommit, w }
}

function changeSet(repo, server = 'DEV-G') {
    const s = cl.startSession('Contractor rollup', server, 'admin')
    cl.setSessionCommit(s.id, repo.devCommit)
    cl.writeLog({
        server, action: 'ELEMENT_ADDED', objectType: 'dimension', objectName: 'Employee', detail: 'Y',
        afterState: { element: 'Y', type: 'Numeric', parent: null, weight: 1 }, user: 'admin',
    })
    cl.writeLog({
        server, action: 'ELEMENT_LINKED', objectType: 'dimension', objectName: 'Employee', detail: 'B under A',
        afterState: { element: 'B', parent: 'A', weight: 1 }, user: 'admin',
    })
    cl.writeLog({
        server, action: 'CHORE_UPDATED', objectType: 'chore', objectName: 'Nightly',
        beforeState: { StartTime: '22:00', Frequency: 'D', ExecutionMode: 'SingleCommit' },
        afterState: { StartTime: '21:00', Frequency: 'D', ExecutionMode: 'SingleCommit' }, user: 'admin',
    })
    return s
}

test('the release takes the target Live, applies only recorded changes, keeps the target’s load', async () => {
    const repo = setupRepo()
    try {
        fakeBase = repo.base
        const s = changeSet(repo)
        const r = await buildRelease(s, 'T1', { token: 'x', gitUser: 't', repoUrl: repo.bare, liveAttrsFiles: {} })
        assert.equal(r.ok, true, JSON.stringify(r))
        assert.equal(r.fromLive, true)

        const vw = W()
        try {
            g(vw, 'init', '-q'); g(vw, 'remote', 'add', 'origin', repo.bare)
            g(vw, 'fetch', '-q', 'origin', 'refs/heads/release-T1:rel')
            const doc = JSON.parse(g(vw, 'show', 'rel:dimensions/Employee.hierarchies/Employee.json'))
            const names = doc.Elements.map(elementName).sort()
            assert.deepEqual(names, ['A', 'B', 'Group', 'X', 'Y'], 'target-added X and record-added Y; Z stays removed; colleague K not shipped')
            assert.ok(doc.Edges.some(e => edgeParent(e) === 'A' && edgeChild(e) === 'B'), 'the recorded move is applied')
            assert.ok(doc.Edges.some(e => edgeParent(e) === 'Group' && edgeChild(e) === 'B'), 'the target keeps its own parent too')
            assert.ok(r.targetNotes.some(n => /Employee: kept X/.test(n)), JSON.stringify(r.targetNotes))
            assert.ok(r.targetNotes.some(n => /Z stays deleted/.test(n)), JSON.stringify(r.targetNotes))
        } finally { fs.rmSync(vw, { recursive: true, force: true }) }

        // The chore keeps the target's schedule unless the record changed it — here
        // both sides agree on 21:00? No: live is 22:00, record sets 21:00, base 22:00,
        // so only DEV changed it: take the record.
        const cw = W()
        try {
            g(cw, 'init', '-q'); g(cw, 'remote', 'add', 'origin', repo.bare)
            g(cw, 'fetch', '-q', 'origin', 'refs/heads/release-T1:rel')
            const chore = JSON.parse(g(cw, 'show', 'rel:chores/Nightly.json'))
            assert.equal(chore.StartTime, '21:00')
        } finally { fs.rmSync(cw, { recursive: true, force: true }) }
    } finally {
        fs.rmSync(repo.bare, { recursive: true, force: true })
        fs.rmSync(repo.w, { recursive: true, force: true })
    }
})

test('a target removal stays removed; a record that uses the removed element stops', () => {
    const live = {
        Elements: [{ Name: 'A', Type: 'Numeric' }],
        Edges: [{ ParentName: 'Group', ComponentName: 'A', Weight: 1 }],
    }
    // Z was on the target and removed; a record that deletes it is already after.
    const gone = applyDimensionChanges(live, { elements: [{ action: 'delete', name: 'Z' }] })
    assert.deepEqual(gone.stops, [])
    assert.deepEqual(gone.doc.Elements.map(elementName), ['A'])

    // A record that adds an edge under a target-removed parent stops.
    const use = applyDimensionChanges(live, { elements: [{ action: 'link', name: 'A', parent: 'Gone', weight: 1 }] })
    assert.equal(use.stops.length, 1)
    assert.match(use.stops[0], /Gone/)
})

test('a recorded change whose before value no longer matches Live stops', () => {
    const live = { Elements: [{ Name: 'B', Type: 'Numeric' }], Edges: [{ ParentName: 'Q', ComponentName: 'B', Weight: 1 }] }
    const moved = applyDimensionChanges(live, { elements: [{ action: 'delete', name: 'B', before: { parent: 'P' } }] })
    assert.equal(moved.stops.length, 1)
    assert.match(moved.stops[0], /target moved it under Q/)

    const weight = applyDimensionChanges(
        { Elements: [{ Name: 'A', Type: 'Numeric' }, { Name: 'B', Type: 'Numeric' }], Edges: [{ ParentName: 'A', ComponentName: 'B', Weight: 2 }] },
        { elements: [{ action: 'weight', name: 'B', parent: 'A', from: 1, to: 3 }] },
    )
    assert.equal(weight.stops.length, 1)
    assert.match(weight.stops[0], /expects 1/)
})

test('the written-file check catches a missing element (injected bug)', () => {
    const live = { Elements: [{ Name: 'A', Type: 'Numeric' }, { Name: 'B', Type: 'Numeric' }], Edges: [] }
    const written = { Elements: [{ Name: 'A', Type: 'Numeric' }], Edges: [] }
    const problems = checkWrittenHierarchy(live, written, { elements: [] })
    assert.equal(problems.length, 1)
    assert.match(problems[0], /element B/)
})

test('attribute values: both sides changed stops; only the target changed is never written; an alias clash stops', () => {
    const records = { dimensions: new Map([['Employee', { attrDefs: [], values: [
        { element: 'Sarah', attribute: 'Grade', before: '3', after: '4' },
        { element: 'Tom', attribute: 'Alias', before: '', after: 'T' },
    ] }]]) }
    const live = { Employee: {
        attributes: [{ Name: 'Grade', Type: 'String' }, { Name: 'Alias', Type: 'Alias' }],
        elements: [
            { Name: 'Sarah', Values: { Grade: '2', Alias: 'S' } },
            { Name: 'Tom', Values: { Grade: '5', Alias: '' } },
        ],
    } }
    const base = { Employee: {
        attributes: [{ Name: 'Grade', Type: 'String' }, { Name: 'Alias', Type: 'Alias' }],
        elements: [
            { Name: 'Sarah', Values: { Grade: '3', Alias: 'S' } },
            { Name: 'Tom', Values: { Grade: '5', Alias: '' } },
        ],
    } }
    const plan = planAttributeChanges(records, { live, base, haveBase: true })
    assert.equal(plan.stops.some(s => /Sarah\.Grade/.test(s)), true, 'PROD moved Sarah too — stop')

    const ok = planAttributeChanges(
        { dimensions: new Map([['Employee', { attrDefs: [], values: [{ element: 'Sarah', attribute: 'Grade', before: '3', after: '4' }] }]]) },
        { live: { Employee: { attributes: [{ Name: 'Grade', Type: 'String' }], elements: [{ Name: 'Sarah', Values: { Grade: '4' } }] } }, base: {}, haveBase: false },
    )
    assert.deepEqual(ok.values, [], 'already after — nothing to write')
    assert.deepEqual(ok.stops, [])

    const clash = planAttributeChanges(
        { dimensions: new Map([['Employee', { attrDefs: [], values: [{ element: 'Tom', attribute: 'Alias', before: '', after: 'S' }] }]]) },
        { live: { Employee: { attributes: [{ Name: 'Alias', Type: 'Alias' }], elements: [
            { Name: 'Sarah', Values: { Alias: 'S' } }, { Name: 'Tom', Values: { Alias: '' } },
        ] } }, base: {}, haveBase: false },
    )
    assert.equal(clash.stops.length, 1)
    assert.match(clash.stops[0], /already the alias of Sarah/)
})

test('chores: both sides changed the schedule stops; the on/off flag is never touched', () => {
    const live = { StartTime: '22:00', Frequency: 'D', ExecutionMode: 'SingleCommit', Active: true }
    const base = { StartTime: '20:00', Frequency: 'D', ExecutionMode: 'SingleCommit' }
    const r = applyChoreChanges(live, {
        before: { StartTime: '20:00' }, after: { StartTime: '21:00' },
    }, { baseJson: base })
    assert.equal(r.stops.length, 1)
    assert.match(r.stops[0], /target changed it to 22:00/)

    const ok = applyChoreChanges(live, {
        before: { StartTime: '22:00' }, after: { StartTime: '23:00' },
    }, { baseJson: { StartTime: '22:00' } })
    assert.deepEqual(ok.stops, [])
    assert.equal(ok.doc.StartTime, '23:00')
    assert.equal(ok.doc.Active, true, 'the on/off flag is not part of a deploy')
})

// ── Part G.5: every index finds its files ───────────────────────────────────
function setupLinksRepo() {
    const bare = BARE()
    execFileSync('git', ['init', '-q', '--bare', bare])
    const w = W()
    g(w, 'init', '-q')
    g(w, 'remote', 'add', 'origin', bare)

    write(w, 'dimensions/Employee.json', dim(['Employee.hierarchies/Employee.json']))
    write(w, 'dimensions/Employee.hierarchies/Employee.json', JSON.stringify({
        Elements: [{ Name: 'A', Type: 'Numeric' }],
        Edges: [],
        'Subsets@Code.links': ['Employee.subsets/Default.json'],
    }, null, '\t'))
    write(w, 'dimensions/Employee.hierarchies/Employee.subsets/Default.json', subset('Default', ['A']))
    write(w, 'cubes/Employee.json', JSON.stringify({ Name: 'Employee', 'Views@Code.links': [] }, null, '\t'))
    const base = commitAll(w, 'base')
    g(w, 'branch', 'main', base)
    g(w, 'push', '-q', 'origin', 'main:main')

    // The target has the Default subset with its own members.
    write(w, 'dimensions/Employee.hierarchies/Employee.subsets/Default.json', subset('Default', ['A', 'TargetOnly']))
    write(w, 'cubes/Employee.json', JSON.stringify({ Name: 'Employee', 'Views@Code.links': [] }, null, '\t'))
    commitAll(w, 'target live')
    g(w, 'push', '-q', 'origin', 'HEAD:live-TL')

    g(w, 'checkout', '-q', 'main')
    // DEV: a changed hierarchy (A + B), a DEV-only subset U linked in the cube's
    // view index, and a new target view V this change set DOES own.
    write(w, 'dimensions/Employee.hierarchies/Employee.json', JSON.stringify({
        Elements: [{ Name: 'A', Type: 'Numeric' }, { Name: 'B', Type: 'Numeric' }],
        Edges: [],
        'Subsets@Code.links': ['Employee.subsets/Default.json'],
    }, null, '\t'))
    // DEV no longer has Default at all — it must be carried from Live.
    fs.rmSync(path.join(w, 'dimensions/Employee.hierarchies/Employee.subsets/Default.json'), { force: true })
    write(w, 'cubes/Employee.json', JSON.stringify({ Name: 'Employee', 'Views@Code.links': [
        'Employee.views/U.json', 'Employee.views/V.json',
    ] }, null, '\t'))
    write(w, 'cubes/Employee.views/U.json', JSON.stringify({ Name: 'U' }, null, '\t'))
    write(w, 'cubes/Employee.views/V.json', JSON.stringify({ Name: 'V' }, null, '\t'))
    const devCommit = commitAll(w, 'dev')
    g(w, 'branch', '-M', 'dev')
    g(w, 'push', '-q', 'origin', 'dev:dev')
    return { bare, base, devCommit, w }
}

test('a linked file the release does not carry comes from Live; a DEV-only unowned link is removed and named', async () => {
    const repo = setupLinksRepo()
    try {
        fakeBase = repo.base
        const s = cl.startSession('links', 'DEV-GL', 'admin')
        cl.setSessionCommit(s.id, repo.devCommit)
        cl.writeLog({ server: 'DEV-GL', action: 'ELEMENT_ADDED', objectType: 'dimension', objectName: 'Employee', detail: 'B', afterState: { element: 'B', type: 'Numeric' }, user: 'admin' })
        cl.writeLog({ server: 'DEV-GL', action: 'CUBE_UPDATED', objectType: 'cube', objectName: 'Employee', user: 'admin' })
        cl.writeLog({ server: 'DEV-GL', action: 'VIEW_SAVED', objectType: 'view', objectName: 'V', detail: 'Employee', user: 'admin' })

        const r = await buildRelease(s, 'TL', { token: 'x', gitUser: 't', repoUrl: repo.bare, liveAttrsFiles: {} })
        assert.equal(r.ok, true, JSON.stringify(r))
        const vw = W()
        try {
            g(vw, 'init', '-q'); g(vw, 'remote', 'add', 'origin', repo.bare)
            g(vw, 'fetch', '-q', 'origin', 'refs/heads/release-TL:rel')
            const files = g(vw, 'ls-tree', '-r', '--name-only', 'rel').split('\n').filter(Boolean)
            assert.ok(files.includes('dimensions/Employee.hierarchies/Employee.subsets/Default.json'), 'carried from Live so the hierarchy index is valid')
            assert.ok(!files.includes('cubes/Employee.views/U.json'), 'U is not this change set\'s')
            assert.ok(files.includes('cubes/Employee.views/V.json'), 'V belongs to this change set and is carried from DEV')
            const cube = JSON.parse(g(vw, 'show', 'rel:cubes/Employee.json'))
            assert.deepEqual(cube['Views@Code.links'], ['Employee.views/V.json'], 'U link removed from the index')
            // The subset file is present so the hierarchy index is valid. The target's
            // own copy is never overwritten by the after-pull step (only this change
            // set's subsets are applied), so its content can differ from the tree.
            const def = JSON.parse(g(vw, 'show', 'rel:dimensions/Employee.hierarchies/Employee.subsets/Default.json'))
            assert.ok(Array.isArray(def.Elements))
            assert.ok(r.indexNotes.some(n => /U\.json/.test(n) || /U/.test(n)), JSON.stringify(r.indexNotes))
        } finally { fs.rmSync(vw, { recursive: true, force: true }) }
    } finally {
        fs.rmSync(repo.bare, { recursive: true, force: true })
        fs.rmSync(repo.w, { recursive: true, force: true })
    }
})

test('a value the target changed itself, with no record in this change set, is never written', () => {
    const records = { dimensions: new Map([['Employee', { attrDefs: [], values: [{ element: 'Tom', attribute: 'Grade', before: '1', after: '2' }] }]]) }
    const live = { Employee: { attributes: [{ Name: 'Grade', Type: 'String' }], elements: [
        { Name: 'Sarah', Values: { Grade: '4' } },     // PROD changed Sarah; not recorded
        { Name: 'Tom', Values: { Grade: '1' } },
    ] } }
    const base = { Employee: { attributes: [{ Name: 'Grade', Type: 'String' }], elements: [
        { Name: 'Sarah', Values: { Grade: '3' } },
        { Name: 'Tom', Values: { Grade: '1' } },
    ] } }
    const plan = planAttributeChanges(records, { live, base, haveBase: true })
    assert.deepEqual(plan.stops, [])
    assert.deepEqual(plan.values, [{ dim: 'Employee', element: 'Tom', attribute: 'Grade', value: '2', type: 'String' }])
    assert.ok(!plan.values.some(v => v.element === 'Sarah'), 'Sarah stays Grade 4 on the target')
})
