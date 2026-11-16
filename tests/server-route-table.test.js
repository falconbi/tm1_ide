'use strict'
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { app } = require('../server')
const snapshot = require('./fixtures/route-table.json')

test('the server registers the same routes, in the same order', () => {
  const rows = []
  for (const layer of app.router.stack) {
    if (!layer.route) continue
    for (const method of Object.keys(layer.route.methods)) rows.push(`${method.toUpperCase()} ${layer.route.path}`)
  }
  assert.deepEqual(rows, snapshot)
})
