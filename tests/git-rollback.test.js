'use strict'

// Return-to-last-release is the recovery for a target that is half-applied or
// unrecognisable. Its guards are the interesting part: it must refuse without the
// typed confirmation, and refuse when there is nothing recorded to return to.
// (The pull itself needs a live target; that part is exercised on the lab.)

const { test } = require('node:test')
const assert = require('node:assert/strict')
const { returnToLastRelease } = require('../core/git-rollback')

test('it refuses without the target name typed exactly', async () => {
    await assert.rejects(
        () => returnToLastRelease('TM1_Test_PROD', { confirm: 'tm1_test_prod' }),
        (e) => e.refused === true && /type the target name/i.test(e.message),
    )
})

test('it refuses when the target has never had a release recorded', async () => {
    await assert.rejects(
        () => returnToLastRelease('ZZ_NoSuchTarget', { confirm: 'ZZ_NoSuchTarget' }),
        (e) => e.refused === true && /no recorded last release/i.test(e.message),
    )
})
