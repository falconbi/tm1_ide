'use strict'

// Operations own when a chore runs and whether it is on. The refresh copies the
// target's SCHEDULE so the deploy does not move it back, but DEV's chore is left
// off — a dev server running a chore at production times is an incident.

const { test } = require('node:test')
const assert = require('node:assert/strict')
const { diffChore } = require('../core/refresh-dev')

const chore = (o = {}) => ({ StartTime: '2026-11-09T02:19:24-08:00', Frequency: 'P1DT00H00M00S', ExecutionMode: 'MultipleCommit', Active: false, ...o })

test('a different start time is a schedule difference', () => {
    const d = diffChore(chore(), chore({ StartTime: '2026-11-10T02:19:24-08:00' }))
    assert.equal(d.scheduleDiffers, true)
    assert.deepEqual(d.fields, ['StartTime'])
})

test('a different frequency or execution mode counts too', () => {
    assert.deepEqual(diffChore(chore(), chore({ Frequency: 'PT5M' })).fields, ['Frequency'])
    assert.deepEqual(diffChore(chore(), chore({ ExecutionMode: 'SingleCommit' })).fields, ['ExecutionMode'])
})

test('an identical schedule is not a difference, whatever the flag', () => {
    const d = diffChore(chore({ Active: true }), chore({ Active: false }))
    assert.equal(d.scheduleDiffers, false)
    // the flag difference is reported, not copied by the refresh
    assert.equal(d.targetActive, true)
    assert.equal(d.devActive, false)
})

test('a DEV chore that is on is flagged as one that must stay off', () => {
    assert.equal(diffChore(chore(), chore({ Active: true })).devMustStayOff, true)
})

test('missing fields compare as text, never as a crash', () => {
    assert.doesNotThrow(() => diffChore(undefined, undefined))
    assert.equal(diffChore({}, {}).scheduleDiffers, false)
})
