'use strict'
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { odataKey, odataLit } = require('../core/odata-key')

test('odataKey doubles apostrophes for the OData literal, leaving them un-encoded', () => {
  // `'` → `''`; encodeURIComponent keeps `'` literal, so the doubled form reaches
  // the server (percent-encoding it to %27 would break the quoted key literal).
  assert.equal(odataKey(`zz_esc_Test's #1 %`), `zz_esc_Test''s%20%231%20%25`)
  assert.equal(odataKey(`a'b`), `a''b`)
  assert.ok(!odataKey(`zz_esc_Test's`).includes('%27'), 'no percent-encoded quote')
})

test('odataKey percent-encodes the lab specials (% # ? & + space)', () => {
  assert.equal(odataKey('%'), '%25')
  assert.equal(odataKey('#'), '%23')
  assert.equal(odataKey('?'), '%3F')
  assert.equal(odataKey('&'), '%26')
  assert.equal(odataKey('+'), '%2B')
  assert.equal(odataKey(' '), '%20')
})

test('odataKey matches encodeURIComponent for names without apostrophes (no regression)', () => {
  assert.equal(odataKey('WFP Cost Centre'), encodeURIComponent('WFP Cost Centre'))
  assert.equal(odataKey('zz_esc_Q?1 s'), encodeURIComponent('zz_esc_Q?1 s'))
  assert.equal(odataKey('plain'), 'plain')
})

test('odataKey coerces non-strings', () => {
  assert.equal(odataKey(123), '123')
  assert.equal(odataKey(null), 'null')
  assert.equal(odataKey(''), '')
})

test('odataLit doubles apostrophes only (filter/TI-string literal form)', () => {
  assert.equal(odataLit(`Test's`), `Test''s`)
  assert.equal(odataLit(`a'b'c`), `a''b''c`)
  assert.equal(odataLit('plain % #'), 'plain % #')   // literal form stays raw — transport encodes
  assert.equal(odataLit(7), '7')
})