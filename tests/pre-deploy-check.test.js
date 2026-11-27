'use strict'

// Part D — the pre-deploy check sorts what changed on a target into "stop" and
// "keep", before anything is built or deployed. The classification is pure; the
// orchestrator is exercised with injected snapshots.

const { test } = require('node:test')
const assert = require('node:assert/strict')
const path = require('path')

const { fileKind, classifyDrift, stopMessage, preDeployCheck } = require('../core/pre-deploy')

test('a rule or process on the target stops and offers the carry-back', () => {
    const r = classifyDrift([
        { status: 'M', file: 'cubes/Salary.rules' },
        { status: 'M', file: 'processes/Load People.json' },
        { status: 'M', file: 'processes/Load People.ti' },
    ])
    assert.equal(r.stops.length, 3)
    assert.equal(r.carryBack.length, 3)
    assert.match(r.stops[0].reason, /bring it onto DEV/)
    assert.equal(r.kept.length, 0)
})

test('cube structure stops, but a cube that differs only in its view list is the view family', () => {
    const r = classifyDrift([
        { status: 'M', file: 'cubes/Sales.json' },
        { status: 'M', file: 'cubes/Sales.json', kind: 'cube-views' },
    ])
    assert.equal(r.stops.length, 1)
    assert.equal(r.stops[0].object, 'Sales')
    assert.equal(r.kept.length, 1)
    assert.equal(r.kept[0].kind, 'view')
})

test('elements, subsets, views and chores are kept and named for the sync', () => {
    const entries = [
        { status: 'M', file: 'dimensions/Employee.hierarchies/Employee.json', summary: '+2 elements: A, B' },
        { status: 'A', file: 'dimensions/Employee.hierarchies/Employee.subsets/New.json', summary: '2 members: A, B' },
        { status: 'M', file: 'cubes/Sales.views/Default.json' },
        { status: 'M', file: 'chores/Nightly.json' },
    ]
    const r = classifyDrift(entries)
    assert.equal(r.stops.length, 0)
    assert.deepEqual(r.kept.map(k => k.kind).sort(), ['chore', 'dimension', 'subset', 'view'])
    assert.equal(r.sync.length, 4)
    assert.match(r.kept.find(k => k.kind === 'chore').reason, /chore off/)
    // Names are the model objects, not Git path segments, and the summary travels.
    assert.equal(r.kept.find(k => k.kind === 'dimension').object, 'Employee')
    assert.equal(r.kept.find(k => k.kind === 'dimension').summary, '+2 elements: A, B')
    assert.equal(r.kept.find(k => k.kind === 'subset').object, 'New')
    assert.equal(r.kept.find(k => k.kind === 'subset').summary, '2 members: A, B')
    assert.equal(r.kept.find(k => k.kind === 'view').object, 'Sales')
    assert.equal(stopMessage(r.stops), null)
})

test('the stop message names each object and says nothing was written', () => {
    const r = classifyDrift([{ status: 'M', file: 'cubes/Salary.rules' }])
    assert.match(stopMessage(r.stops), /Salary \(rule-process\)/)
    assert.match(stopMessage(r.stops), /Nothing was written/)
})

test('a running process stops the check before anything else', async () => {
    const out = await preDeployCheck('PROD', {
        token: 't', gitUser: 'g',
        deps: {
            idleCheck: async (server) => (server === 'PROD' ? { running: [{ name: 'Nightly' }] } : { running: [] }),
            driftCheck: async () => ({ deployed: 'C1', liveBranch: 'live-PROD', entries: [] }),
            collectAttrsFiles: async () => ({}),
            writeAttrsBranch: async () => ({ ok: true, changed: false, commit: 'A1', branch: 'attrs-PROD' }),
        },
        client: { post: async () => ({ URL: 'https://repo' }) },
    })
    assert.equal(out.ok, false)
    assert.equal(out.stops[0].kind, 'idle')
    assert.equal(out.stops[0].object, 'PROD')
})

test('a clean target passes and records the live and attribute snapshots', async () => {
    const out = await preDeployCheck('PROD', {
        token: 't', gitUser: 'g',
        deps: {
            idleCheck: async () => ({ running: [] }),
            driftCheck: async () => ({ deployed: 'C1', liveBranch: 'live-PROD', entries: [] }),
            collectAttrsFiles: async () => ({ 'attributes/Employee.json': '{}' }),
            writeAttrsBranch: async (server, { message }) => ({ ok: true, changed: true, commit: 'A2', branch: `attrs-${server}`, message }),
        },
        client: { post: async () => ({ URL: 'https://repo' }) },
    })
    assert.equal(out.ok, true, out.message)
    assert.equal(out.live.deployed, 'C1')
    assert.equal(out.attrs.commit, 'A2')
    assert.equal(out.attrs.changed, true)
})

test('a rule changed on the target is a stop with the carry-back named', async () => {
    const out = await preDeployCheck('PROD', {
        token: 't', gitUser: 'g',
        deps: {
            idleCheck: async () => ({ running: [] }),
            driftCheck: async () => ({ deployed: 'C1', liveBranch: 'live-PROD', entries: [{ status: 'M', file: 'cubes/Salary.rules' }] }),
            collectAttrsFiles: async () => ({}),
            writeAttrsBranch: async () => ({ ok: true, commit: 'A3', branch: 'attrs-PROD' }),
        },
        client: { post: async () => ({ URL: 'https://repo' }) },
    })
    assert.equal(out.ok, false)
    assert.equal(out.carryBack.length, 1)
    assert.match(out.message, /Salary/)
})

test('an attribute file is an attribute, named by its dimension', () => {
    const { fileKind: kind, fileObject: name } = require('../core/pre-deploy')
    assert.equal(kind('attributes/WFP Employee.json'), 'attribute')
    assert.equal(name('attributes/WFP Employee.json'), 'WFP Employee')
})

test('attributes changed on the target are kept and offered to the sync', async () => {
    const doc = (grade) => ({ attributes: [{ Name: 'Grade', Type: 'String' }], elements: [{ Name: 'Sarah', Values: { Grade: grade } }] })
    const out = await preDeployCheck('PROD', {
        token: 't', gitUser: 'g',
        deps: {
            idleCheck: async () => ({ running: [] }),
            driftCheck: async () => ({ deployed: 'C1', liveBranch: 'live-PROD', entries: [] }),
            collectAttrsFiles: async () => ({ 'attributes/Employee.json': '{}' }),
            writeAttrsBranch: async () => ({ ok: true, commit: 'A2', branch: 'attrs-PROD' }),
            latestDeployTo: () => ({ status: 'complete', attrs_commit: 'A1' }),
            readAttrsAtCommit: (url, commit) => ({ Employee: doc(commit === 'A2' ? '4' : '3') }),
        },
        client: { post: async () => ({ URL: 'https://repo' }) },
    })

    assert.equal(out.ok, true, out.message)
    assert.deepEqual(out.kept.map(k => [k.kind, k.object]), [['attribute', 'Employee']])
    assert.equal(out.sync.length, 1)
    assert.match(out.kept[0].reason, /run the sync/)
})

test('unchanged attributes are not named', async () => {
    const doc = { attributes: [{ Name: 'Grade', Type: 'String' }], elements: [{ Name: 'Sarah', Values: { Grade: '3' } }] }
    const out = await preDeployCheck('PROD', {
        token: 't', gitUser: 'g',
        deps: {
            idleCheck: async () => ({ running: [] }),
            driftCheck: async () => ({ deployed: 'C1', liveBranch: 'live-PROD', entries: [] }),
            collectAttrsFiles: async () => ({ 'attributes/Employee.json': '{}' }),
            writeAttrsBranch: async () => ({ ok: true, commit: 'A2', branch: 'attrs-PROD' }),
            latestDeployTo: () => ({ status: 'complete', attrs_commit: 'A1' }),
            readAttrsAtCommit: () => ({ Employee: doc }),
        },
        client: { post: async () => ({ URL: 'https://repo' }) },
    })
    assert.equal(out.kept.length, 0)
    assert.equal(out.sync.length, 0)
})

test('the check names what PROD has that DEV lacks, per changed object', async () => {
    const out = await preDeployCheck('PROD', {
        source: 'DEV', token: 't', gitUser: 'g',
        deps: {
            idleCheck: async () => ({ running: [] }),
            driftCheck: async () => ({
                deployed: 'C1', liveBranch: 'live-PROD', liveCommit: 'L1',
                entries: [
                    { status: 'M', file: 'dimensions/WFP Employee.hierarchies/WFP Employee.json', prodAdded: { elements: ['ZZ_TEST_EMP_A'], edges: [] } },
                    { status: 'A', file: 'dimensions/WFP Employee.hierarchies/WFP Employee.subsets/Test_New_Adds.json', prodMembers: ['ZZ_TEST_EMP_A'] },
                ],
            }),
            collectAttrsFiles: async () => ({}),
            writeAttrsBranch: async () => ({ ok: true, commit: 'A2', branch: 'attrs-PROD' }),
            latestDeployTo: () => null,
            sourceClient: {
                getElements: async () => [{ Name: 'E10001' }],
                getEdges: async () => [],
                getSubsetElements: async () => null,
            },
        },
        client: { post: async () => ({ URL: 'https://repo' }) },
    })

    const dim = out.kept.find(k => k.kind === 'dimension')
    assert.deepEqual(dim.devMissing, { kind: 'dimension', elements: ['ZZ_TEST_EMP_A'], edges: [] })
    const sub = out.kept.find(k => k.kind === 'subset')
    assert.deepEqual(sub.devMissing, { kind: 'subset', missing: true })
})

test('a subset DEV already has names only the members it lacks', async () => {
    const out = await preDeployCheck('PROD', {
        source: 'DEV', token: 't', gitUser: 'g',
        deps: {
            idleCheck: async () => ({ running: [] }),
            driftCheck: async () => ({
                deployed: 'C1', liveBranch: 'live-PROD', liveCommit: 'L1',
                entries: [{ status: 'M', file: 'dimensions/D.hierarchies/D.subsets/S.json', prodMembers: ['A', 'B'] }],
            }),
            collectAttrsFiles: async () => ({}),
            writeAttrsBranch: async () => ({ ok: true, commit: 'A2', branch: 'attrs-PROD' }),
            latestDeployTo: () => null,
            sourceClient: { getSubsetElements: async () => [{ name: 'A' }] },
        },
        client: { post: async () => ({ URL: 'https://repo' }) },
    })
    assert.deepEqual(out.kept[0].devMissing, { kind: 'subset', missing: false, members: ['B'] })
})
