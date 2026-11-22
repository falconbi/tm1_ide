'use strict'

// Attribute definitions first: an attribute PROD has that DEV lacks is a real gap
// (a rule or a view reads it). Values are a separate decision — only for attributes
// whose owner confirmed PROD's load maintains them, never wholesale.

const { test } = require('node:test')
const assert = require('node:assert/strict')
const { diffAttributeDefinitions } = require('../core/refresh-dev')

const a = (Name, Type = 'String') => ({ Name, Type })

test('an attribute only PROD has is added', () => {
    const d = diffAttributeDefinitions([a('Description'), a('Loaded')], [a('Description')])
    assert.deepEqual(d.add, [{ name: 'Loaded', type: 'S' }])
    assert.equal(d.differs, true)
})

test('an attribute only DEV has is reported, never removed', () => {
    const d = diffAttributeDefinitions([a('Description')], [a('Description'), a('Local Only')])
    assert.deepEqual(d.onlyDev, ['Local Only'])
    assert.equal(d.add.length, 0)
    assert.equal(d.differs, false, 'a DEV-only attribute is not a gap in DEV')
})

test('a type difference is reported', () => {
    const d = diffAttributeDefinitions([a('Grade', 'Numeric')], [a('Grade', 'String')])
    assert.deepEqual(d.typeChanges, [{ name: 'Grade', from: 'S', to: 'N' }])
})

test('matching definitions, however spelled, are not a difference', () => {
    const d = diffAttributeDefinitions([a('Grade', 'N')], [a('Grade', 'Numeric')])
    assert.equal(d.differs, false)
})

test('nothing on either side is not a difference', () => {
    assert.equal(diffAttributeDefinitions([], []).differs, false)
    assert.equal(diffAttributeDefinitions(undefined, undefined).differs, false)
})

// Which attributes PROD's own processes write — a SUGGESTION for an admin to
// confirm, never applied on its own. A process passing variables yields nothing,
// which is honest: a guess is worse than a gap.

const { suggestAttributeWrites } = require('../core/refresh-dev')

test('literal AttrPutS/AttrPutN calls name the dimension and the attribute', () => {
    const s = suggestAttributeWrites([
        { PrologProcedure: "AttrPutS('Loaded', 'WFP Employee', vEl, 'Source');" },
        { PrologProcedure: "AttrPutN(1, 'WFP Position', vPos, 'Budgeted');" },
    ])
    assert.deepEqual(s, { 'WFP Employee': ['Source'], 'WFP Position': ['Budgeted'] })
})

test('ElementAttrPut* is read too', () => {
    const s = suggestAttributeWrites([{ PrologProcedure: "ElementAttrPutS('x', 'WFP Cost Centre', vEl, 'Owner');" }])
    assert.deepEqual(s, { 'WFP Cost Centre': ['Owner'] })
})

test('a call with variables instead of literals suggests nothing', () => {
    const s = suggestAttributeWrites([{ PrologProcedure: "AttrPutS(vVal, cDim, vEl, vAttr);" }])
    assert.deepEqual(s, {})
})

test('the same attribute written twice is listed once', () => {
    const s = suggestAttributeWrites([{ PrologProcedure: "AttrPutS('a','D',vEl,'X'); AttrPutS('b','D',vEl,'X');" }])
    assert.deepEqual(s, { D: ['X'] })
})
