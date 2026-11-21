'use strict'

// A view is two files when it is MDX-driven: cubes/<cube>.views/<view>.json and
// cubes/<cube>.views/<view>.mdx. Mapping only the .json made an MDX-only change
// invisible — the release could ship a view the target had also changed, and the
// REST complement would replace the target's text without anyone seeing it.

const { test } = require('node:test')
const assert = require('node:assert/strict')
const { objectFromFile, viewSubsetConflicts, objectKey, expectedPlanKeys } = require('../core/git-release')

const JSON_FILE = 'cubes/WFP Assignment.views/WFP Assignment Default.json'
const MDX_FILE  = 'cubes/WFP Assignment.views/WFP Assignment Default.mdx'
const SUB_FILE  = 'dimensions/WFP Period.hierarchies/WFP Period.subsets/2026 Months.json'

test('both files of an MDX view map to the same view object', () => {
    assert.deepEqual(objectFromFile(JSON_FILE), { type: 'view', name: 'WFP Assignment Default', parent: 'WFP Assignment' })
    assert.deepEqual(objectFromFile(MDX_FILE), { type: 'view', name: 'WFP Assignment Default', parent: 'WFP Assignment' })
})

test('an MDX-only change on the target conflicts with a release that ships the view', () => {
    const releaseKeys = expectedPlanKeys([{ type: 'view', name: 'WFP Assignment Default', parent: 'WFP Assignment' }])
    const conflicts = viewSubsetConflicts([{ file: MDX_FILE, blocking: false }], releaseKeys)
    assert.equal(conflicts.length, 1)
    assert.equal(conflicts[0].file, MDX_FILE)
})

test('a subset change conflicts with a release that ships that subset', () => {
    const releaseKeys = expectedPlanKeys([{ type: 'subset', name: '2026 Months', parent: 'WFP Period' }])
    const conflicts = viewSubsetConflicts([{ file: SUB_FILE, blocking: false }], releaseKeys)
    assert.equal(conflicts.length, 1)
})

test('an unrelated change on the target does not conflict', () => {
    const releaseKeys = expectedPlanKeys([{ type: 'view', name: 'Something Else', parent: 'WFP Assignment' }])
    const conflicts = viewSubsetConflicts([{ file: MDX_FILE, blocking: false }], releaseKeys)
    assert.equal(conflicts.length, 0)
})

test('the key covers the parent, so an MDX change matches its own view only', () => {
    const keys = expectedPlanKeys([{ type: 'view', name: 'V', parent: 'Cube A' }])
    assert.ok(keys.has(objectKey('view', 'V', 'Cube A')))
    assert.ok(keys.has(objectKey('cube', 'Cube A')))
})
