import { test } from 'node:test'
import assert from 'node:assert/strict'
import { serverCapabilities, serverLabel } from '../client/src/lib/tm1-version.js'

test('V11 has no Jobs or Metrics', () => {
  assert.deepEqual(serverCapabilities('11.8.01300.1'), { jobs: false, metrics: false })
})

test('V12 has Jobs and Metrics', () => {
  assert.deepEqual(serverCapabilities('12.4.0'), { jobs: true, metrics: true })
})

test('unknown version leaves every feature on — the call reports what is missing', () => {
  for (const v of [null, '', 'garbage']) {
    assert.deepEqual(serverCapabilities(v), { jobs: true, metrics: true })
  }
})

test('label shows the release, not just V11/V12', () => {
  assert.equal(serverLabel('12.5.8'), 'V12 · 12.5.8')
  assert.equal(serverLabel('11.8.01300.42'), 'V11 · 11.8.01300')
  assert.equal(serverLabel(null), 'unknown')
})
