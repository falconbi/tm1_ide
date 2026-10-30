'use strict'
// The TI that builds an Alternate Hierarchy from an attribute (core/hierarchy_gen.js).
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { processName, rebuildProcess, referencesHierarchy } = require('../core/hierarchy_gen')
const { lintTI } = require('../core/ti-lint')

test('process name: upper-case prefix kept, else the whole dimension', () => {
    assert.equal(processName('WFP Position', 'By Grade'), 'WFP Rebuild By Grade Hierarchy')
    assert.equal(processName('Region', 'By Country'), 'Region Rebuild By Country Hierarchy')
    assert.equal(processName('Cost Centre', 'By Owner'), 'Cost Centre Rebuild By Owner Hierarchy')
})

test('with a level dimension: mirrors it, unknown values go to "not set", lints clean', () => {
    const p = rebuildProcess({ dimension: 'WFP Position', hierarchy: 'By Location', attribute: 'Location', levelDimension: 'WFP Location', top: 'All Locations' })
    assert.match(p.prolog, /sDH\s+= cDim \| ':' \| cHier;/)
    assert.match(p.prolog, /HierarchyCreate\( cDim, cHier \)/)
    assert.match(p.prolog, /cLvl  = 'WFP Location';/)
    assert.match(p.prolog, /IF\( DIMIX\( cLvl, vGroup \) = 0 \); vGroup = cNone; ENDIF;/)
    assert.match(p.prolog, /cNone = 'Location not set';/)
    assert.match(p.prolog, /SubsetCreateByMDX\( 'Default', '\{TM1DRILLDOWNMEMBER\(\{\[WFP Position\]\.\[By Location\]\.\[All Locations\]\}, ALL, RECURSIVE\)\}' \);/)
    const lint = lintTI({ prolog: p.prolog })
    assert.deepEqual(lint.errors, [], JSON.stringify(lint.errors))
})

test('without a level dimension: one group per value under the top; numeric attribute read as text', () => {
    const p = rebuildProcess({ dimension: 'WFP Position', hierarchy: 'By Grade', attribute: 'Grade Level', attributeType: 'Numeric', top: 'All By Grade' })
    assert.doesNotMatch(p.prolog, /DIMSIZ\( cLvl \)/)
    assert.match(p.prolog, /vGroup = NUMBERTOSTRING\( ATTRN\( cDim, vEl, cAttr \) \);/)
    assert.match(p.prolog, /DimensionElementComponentAddDirect\( sDH, cTop, vGroup, 1 \);/)
    assert.deepEqual(lintTI({ prolog: p.prolog }).errors, [])
})

test('quotes in names are doubled in the TI', () => {
    const p = rebuildProcess({ dimension: "O'Brien Dim", hierarchy: "Mgr's view", attribute: 'Owner', top: 'All' })
    assert.match(p.prolog, /cDim  = 'O''Brien Dim';/)
    assert.match(p.prolog, /cHier = 'Mgr''s view';/)
})

test('built-by detection: generated code, and a hand-written one using dim | : | hier', () => {
    const gen = rebuildProcess({ dimension: 'WFP Position', hierarchy: 'By Location', attribute: 'Location', top: 'All Locations' }).prolog
    assert.ok(referencesHierarchy(gen, 'WFP Position', 'By Location'))
    assert.ok(referencesHierarchy("x = DIMIX( 'WFP Position:By Location', 'ENG-001' );", 'WFP Position', 'By Location'))
    assert.ok(!referencesHierarchy("x = DIMIX( 'WFP Position', 'ENG-001' );", 'WFP Position', 'By Location'))
})
