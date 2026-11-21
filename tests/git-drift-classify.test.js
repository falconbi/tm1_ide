'use strict'

// TM1's pull never applies views or subsets (the IDE applies them itself, after
// the pull, only for the release's own objects). A change to one therefore cannot
// be damaged by a deploy, so it is reported and not blocked. Everything else is
// in the pull and still blocks.

const { test } = require('node:test')
const assert = require('node:assert/strict')
const { classifyDriftFile } = require('../core/git-drift')

test('a view or subset change is reported but not blocking', () => {
    for (const file of [
        'cubes/WFP Assignment.views/WFP Assignment Default.json',
        'cubes/WFP Assignment.views/WFP Assignment Default.mdx',
        'dimensions/WFP Period.hierarchies/WFP Period.subsets/2026 Months.json',
    ]) {
        const c = classifyDriftFile(file)
        assert.equal(c.blocking, false, `${file} should not block`)
    }
})

test('everything the pull touches still blocks', () => {
    for (const file of [
        'dimensions/WFP Position.hierarchies/WFP Position.json',
        'dimensions/WFP Position.json',
        'cubes/WFP Assignment.json',
        'cubes/WFP Assignment.rules',
        'processes/WFP Month End.json',
        'processes/WFP Month End.ti',
        'chores/WFP Month End.json',
    ]) {
        const c = classifyDriftFile(file)
        assert.equal(c.blocking, true, `${file} should block`)
    }
})

test('the classification names the kind, for the report', () => {
    assert.equal(classifyDriftFile('cubes/A.views/V.json').kind, 'view')
    assert.equal(classifyDriftFile('dimensions/D.hierarchies/D.subsets/S.json').kind, 'subset')
    assert.equal(classifyDriftFile('processes/P.json').kind, 'object')
})
