'use strict'
const test = require('node:test')
const assert = require('node:assert')
const { parseRuleLens } = require('../core/rule_lens')

const measures = new Set(['A', 'B', 'C', 'D'])

test('parses calc areas, measures, DB sources and feeders', () => {
    const rules = `# header — DB('Ghost') in a comment is not a source
['A', 'B'] = N: IF( DB('Src', 'x') > 0, DB('Src2', 'y'), 0 );
['C'] = N:
  DB('Src', 'z') + 1;
FEEDERS;
['A'] => DB('Tgt', 'x');
['B'] => ['D'];`
    const r = parseRuleLens(rules, { measureElements: measures })
    assert.equal(r.items.length, 4)
    const calc = r.items.filter(i => i.type === 'calc')
    assert.deepEqual(calc[0].measures, ['A', 'B'])
    assert.deepEqual(calc[0].dbSources, ['Src', 'Src2'])
    assert.equal(calc[1].measures[0], 'C')
    assert.deepEqual(calc[1].dbSources, ['Src'])
    const feeders = r.items.filter(i => i.type === 'feeder')
    assert.deepEqual(feeders[0].targetCubes, ['Tgt'])
    assert.deepEqual(feeders[1].measures, ['B'])
    assert.deepEqual(r.summary.cubesRead, ['Src', 'Src2'])
    assert.deepEqual(r.summary.measures, ['A', 'B', 'C'])
    assert.equal(r.summary.feeders, 2)
})

test('semicolons inside strings do not split a rule', () => {
    const r = parseRuleLens("['A'] = S: 'x;y' | 'z';", { measureElements: measures })
    assert.equal(r.items.length, 1)
    assert.equal(r.items[0].expression, "'x;y' | 'z'")
})

test('reads ]] element names and escaped apostrophes', () => {
    const measures = new Set(['Net Sales]YTD', "O'Brien"])
    const r = parseRuleLens("['Net Sales]]YTD'] = N: 1;\n['O''Brien'] = N: 1;", { measureElements: measures })
    assert.deepEqual(r.items[0].areaElements, ['Net Sales]YTD'])
    assert.deepEqual(r.items[0].measures, ['Net Sales]YTD'])
    assert.deepEqual(r.items[1].areaElements, ["O'Brien"])
    assert.deepEqual(r.items[1].measures, ["O'Brien"])
})

test('feeder target cube names with an escaped apostrophe are listed', () => {
    const r = parseRuleLens("FEEDERS;\n['A'] => DB('Bob''s Cube', 'x');", { measureElements: measures })
    assert.deepEqual(r.items[0].targetCubes, ["Bob's Cube"])
})
