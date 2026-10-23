'use strict'

const test = require('node:test')
const assert = require('node:assert')
const { isNeverDeploy } = require('../tools/tm1deploy/src/never-deploy')

test('WFP_Lab objects are never deployable', () => {
    assert.equal(isNeverDeploy('LAB Position'), true)
    assert.equal(isNeverDeploy('LAB Workforce Cost'), true)
    assert.equal(isNeverDeploy('LAB Assignment Base'), true)
    assert.equal(isNeverDeploy('}ElementAttributes_LAB Position'), true)
})

test('real objects are unaffected — including names that merely contain "Lab"', () => {
    assert.equal(isNeverDeploy('WFP Position'), false)
    assert.equal(isNeverDeploy('Capitalised Labour'), false)
    assert.equal(isNeverDeploy('WFP Assignment Detail'), false)
    assert.equal(isNeverDeploy(''), false)
    assert.equal(isNeverDeploy(null), false)
})
