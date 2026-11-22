'use strict'

// The refresh must compare against the LAST DEPLOY, not just PROD with DEV.
// Without a baseline a deliberate deletion on DEV is indistinguishable from an
// addition on PROD — which is how a refresh would have put back the 2,295
// employees and 2,503 positions the WFP cut removed.
//
// These four cases are the rule itself, plus the "no baseline" case and the
// re-run that must not offer the same addition twice.

const { test } = require('node:test')
const assert = require('node:assert/strict')

const { classifyDimension } = require('../core/refresh-dimension')
const { originOf, ORIGIN } = require('../core/refresh-origins')

const el = (Name, Type = 'Numeric') => ({ Name, Type })
const edge = (ParentName, ComponentName, Weight = 1) => ({ ParentName, ComponentName, Weight })
const base = ({ elements = [], edges = [] } = {}) => ({
    elements: new Map(elements.map(e => [e.Name, e.Type])),
    edges: new Map(edges.map(e => [`${e.ParentName}::${e.ComponentName}`, e.Weight])),
})
const side = ({ elements = [], edges = [] } = {}) => ({ elements, edges })

// ── The origin table ────────────────────────────────────────────────────────

test('the presence table names every case, including "both added the same thing"', () => {
    assert.equal(originOf(null, 'x', null), ORIGIN.TARGET_ADDED)
    assert.equal(originOf(null, null, 'x'), ORIGIN.DEV_ADDED)
    assert.equal(originOf(null, 'x', 'x'), ORIGIN.BOTH)          // both added it, identically
    assert.equal(originOf(null, 'x', 'y'), ORIGIN.CONFLICT)      // both added it, differently
    assert.equal(originOf('x', null, null), ORIGIN.BOTH)         // both removed it
    assert.equal(originOf('x', null, 'x'), ORIGIN.TARGET_REMOVED)
    assert.equal(originOf('x', 'x', null), ORIGIN.DEV_REMOVED)
    assert.equal(originOf('x', 'x', 'y', { value: { base: 'x', prod: 'x', dev: 'y' } }), ORIGIN.DEV_CHANGED)
    assert.equal(originOf('x', 'y', 'x', { value: { base: 'x', prod: 'y', dev: 'x' } }), ORIGIN.TARGET_CHANGED)
    assert.equal(originOf('x', 'y', 'z', { value: { base: 'x', prod: 'y', dev: 'z' } }), ORIGIN.CONFLICT)
})

// ── Case 1: DEV deleted an element that is in the baseline and on PROD ──────

test('case 1: an element removed on DEV is NOT offered, and nothing is added', () => {
    const b = base({ elements: [el('E1'), el('E2')] })
    const prod = side({ elements: [el('E1'), el('E2')] })
    const dev = side({ elements: [el('E1')] })            // DEV deleted E2
    const c = classifyDimension(b, prod, dev)
    assert.deepEqual(c.addElements, [])
    assert.deepEqual(c.devRemoved.map(e => e.name), ['E2'])
    assert.equal(c.removeElements.length, 0)
})

// ── Case 2: PROD added an element that is not in the baseline ───────────────

test('case 2: an element PROD added since the last deploy is offered', () => {
    const c = classifyDimension(base({ elements: [el('E1')] }), side({ elements: [el('E1'), el('E9')] }), side({ elements: [el('E1')] }))
    assert.deepEqual(c.addElements.map(e => [e.name, e.origin]), [['E9', ORIGIN.TARGET_ADDED]])
})

// ── Case 3: PROD deleted an element that is in the baseline ─────────────────

test('case 3: an element PROD removed since the last deploy is offered as a decision', () => {
    const c = classifyDimension(base({ elements: [el('E1'), el('E2')] }), side({ elements: [el('E1')] }), side({ elements: [el('E1'), el('E2')] }))
    assert.deepEqual(c.removeElements.map(e => [e.name, e.origin]), [['E2', ORIGIN.TARGET_REMOVED]])
    assert.equal(c.addElements.length, 0)
})

// ── Case 4: both moved the same element, differently ────────────────────────

test('case 4: a member both sides moved differently is a conflict with no default', () => {
    const els = [el('P1', 'Consolidated'), el('P2', 'Consolidated'), el('P3', 'Consolidated'), el('X')]
    const c = classifyDimension(
        base({ elements: els, edges: [edge('P1', 'X')] }),
        side({ elements: els, edges: [edge('P2', 'X')] }),   // PROD moved X to P2
        side({ elements: els, edges: [edge('P3', 'X')] }),   // DEV moved X to P3
    )
    assert.equal(c.moves.length, 0)
    assert.deepEqual(c.moveConflicts.map(m => [m.child, m.toParent, m.fromParent]), [['X', 'P2', 'P3']])
})

test('a move only PROD made is offered; a move only DEV made is not', () => {
    const els = [el('P1', 'Consolidated'), el('P2', 'Consolidated'), el('P3', 'Consolidated'), el('X')]
    const onlyProd = classifyDimension(
        base({ elements: els, edges: [edge('P1', 'X')] }),
        side({ elements: els, edges: [edge('P2', 'X')] }),
        side({ elements: els, edges: [edge('P1', 'X')] }),
    )
    assert.deepEqual(onlyProd.moves.map(m => m.child), ['X'])
    const onlyDev = classifyDimension(
        base({ elements: els, edges: [edge('P1', 'X')] }),
        side({ elements: els, edges: [edge('P1', 'X')] }),
        side({ elements: els, edges: [edge('P3', 'X')] }),
    )
    assert.equal(onlyDev.moves.length, 0)
    assert.deepEqual(onlyDev.devMoved.map(m => m.child), ['X'])
})

// ── Case 6: an addition brought across is not offered again ─────────────────

test('case 6: once DEV has an element PROD added, the next plan offers nothing', () => {
    const b = base({ elements: [el('E1')] })
    const prod = side({ elements: [el('E1'), el('E9')] })
    const before = classifyDimension(b, prod, side({ elements: [el('E1')] }))
    assert.deepEqual(before.addElements.map(e => e.name), ['E9'])
    const after = classifyDimension(b, prod, side({ elements: [el('E1'), el('E9')] }))
    assert.equal(after.addElements.length, 0, 'not offered a second time')
    assert.equal(after.devAdded.length, 0, 'both sides have it now — nothing to do')
})

// ── No baseline ─────────────────────────────────────────────────────────────

test('no baseline: every difference is unknown, nothing is preselected', () => {
    const c = classifyDimension(null, side({ elements: [el('E1'), el('E2')] }), side({ elements: [el('E1')] }))
    assert.equal(c.unknown, true)
    assert.deepEqual(c.addElements.map(e => e.origin), [ORIGIN.UNKNOWN])
})

// ── Types: only a PROD-side change is offered ───────────────────────────────

test('a type PROD changed is offered; a type DEV changed is not', () => {
    const prodChanged = classifyDimension(base({ elements: [el('C', 'Numeric')] }), side({ elements: [el('C', 'Consolidated')] }), side({ elements: [el('C', 'Numeric')] }))
    assert.deepEqual(prodChanged.typeChanges.map(t => [t.name, t.from, t.to]), [['C', 'Numeric', 'Consolidated']])
    const devChanged = classifyDimension(base({ elements: [el('C', 'Numeric')] }), side({ elements: [el('C', 'Numeric')] }), side({ elements: [el('C', 'Consolidated')] }))
    assert.equal(devChanged.typeChanges.length, 0)
})

// ── Edges ──────────────────────────────────────────────────────────────────

test('an edge PROD added is offered; one PROD removed is a decision', () => {
    const els = [el('P', 'Consolidated'), el('A'), el('B')]
    const added = classifyDimension(base({ elements: els, edges: [edge('P', 'A')] }), side({ elements: els, edges: [edge('P', 'A'), edge('P', 'B')] }), side({ elements: els, edges: [edge('P', 'A')] }))
    assert.deepEqual(added.addEdges.map(e => e.child), ['B'])
    const removed = classifyDimension(base({ elements: els, edges: [edge('P', 'A'), edge('P', 'B')] }), side({ elements: els, edges: [edge('P', 'A')] }), side({ elements: els, edges: [edge('P', 'A'), edge('P', 'B')] }))
    assert.deepEqual(removed.removeEdges.map(e => e.child), ['B'])
})

// ── The WFP shape ──────────────────────────────────────────────────────────

test('the WFP cut shape: PROD still had the elements, baseline had them, DEV did not → not offered', () => {
    // This is the exact state that produced "WFP Employee +2,295" on 22 Nov.
    const b = base({ elements: [el('All Employees', 'Consolidated'), el('E1'), el('E2'), el('E3')], edges: [edge('All Employees', 'E1'), edge('All Employees', 'E2'), edge('All Employees', 'E3')] })
    const prod = side({ elements: [el('All Employees', 'Consolidated'), el('E1'), el('E2'), el('E3')], edges: [edge('All Employees', 'E1'), edge('All Employees', 'E2'), edge('All Employees', 'E3')] })
    const dev = side({ elements: [el('All Employees', 'Consolidated'), el('E1')], edges: [edge('All Employees', 'E1')] })
    const c = classifyDimension(b, prod, dev)
    assert.equal(c.addElements.length, 0, 'nothing to bring back')
    assert.deepEqual(c.devRemoved.map(e => e.name).sort(), ['E2', 'E3'])
})

// ── The base's two records: full SHA vs TM1's abbreviation ──────────────────

test('the release branch and the local record match when one is abbreviated', () => {
    const { sameCommit } = require('../core/deploy-base')
    assert.equal(sameCommit('169b73c1325d670433a0b07281b52f42541cc7db', '169b73c1'), true)
    assert.equal(sameCommit('169b73c1', '169b73c1325d670433a0b07281b52f42541cc7db'), true)
    assert.equal(sameCommit('169b73c1325d670433a0b07281b52f42541cc7db', '169b73c1'), true)
    assert.equal(sameCommit('169b73c1', '2b9cdd83'), false)
    // A 6-character prefix is too short to identify a commit.
    assert.equal(sameCommit('169b73c1325d', '169b73'), false)
})
