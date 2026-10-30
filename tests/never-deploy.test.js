'use strict'

const test = require('node:test')
const assert = require('node:assert')
const fs = require('node:fs')
const path = require('node:path')
const { isNeverDeploy, isLabObject } = require('../tools/tm1deploy/src/never-deploy')

test('WFP_Lab objects are never deployable', () => {
    assert.equal(isNeverDeploy('LAB Position'), true)
    assert.equal(isNeverDeploy('LAB Workforce Cost'), true)
    assert.equal(isNeverDeploy('LAB Assignment Base'), true)
    assert.equal(isNeverDeploy('}ElementAttributes_LAB Position'), true)
    assert.equal(isLabObject('LAB Position'), true)
    assert.equal(isLabObject('}bedrock.cube.data.copy'), false)
})

test('Bedrock objects are never deployable — by name or by parent', () => {
    assert.equal(isNeverDeploy('}bedrock.cube.data.copy'), true)
    assert.equal(isNeverDeploy('}bedrock.scratchcube.dim01'), true)
    assert.equal(isNeverDeploy('}bedrock.cube.data.copy.scratchcube'), true)
    assert.equal(isNeverDeploy('_bedrock.cube.data.copy'), true)
    assert.equal(isNeverDeploy('}ElementAttributes_}bedrock.scratchcube.dim01'), true)
    // a view's identity is its cube: "Temp" on a Bedrock scratch cube must go too
    assert.equal(isNeverDeploy({ name: 'Temp', detail: '}bedrock.cube.data.copy.scratchcube' }), true)
    assert.equal(isNeverDeploy({ name: 'Temp', detail: 'WFP Workforce Cost' }), false)
})

test('real objects are unaffected — including names that merely contain "Lab" or "bedrock"', () => {
    assert.equal(isNeverDeploy('WFP Position'), false)
    assert.equal(isNeverDeploy('Capitalised Labour'), false)
    assert.equal(isNeverDeploy('WFP Assignment Detail'), false)
    assert.equal(isNeverDeploy('WFP Seed Prior Forecast'), false)
    assert.equal(isNeverDeploy('Monthly Bedrock Review'), false)
    assert.equal(isNeverDeploy(''), false)
    assert.equal(isNeverDeploy(null), false)
})

// packages/ is gitignored, so this real-release check runs only where the package exists (not in CI)
const SEP15 = path.join(__dirname, '../packages/release-2026-09-15-2026-09-15/manifest.json')
test('the 15 Sep package keeps the WFP process and drops all 122 Bedrock objects', { skip: !fs.existsSync(SEP15) && 'packages/ is gitignored' }, () => {
    const manifest = require(SEP15)
    const kept = manifest.objects.filter(o => !isNeverDeploy(o))
    const dropped = manifest.objects.filter(isNeverDeploy)
    assert.deepEqual(kept.map(o => o.name), ['WFP Seed Prior Forecast'])
    assert.equal(dropped.length, 122)
    assert.ok(dropped.every(o => /bedrock/i.test(o.name) || /bedrock/i.test(o.detail ?? '')))
})
