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

test('a static route is registered before a parameter route that could match it', () => {
  const params = p => p.split('/').filter(s => s.startsWith(':') || s === '{*path}').length
  const matches = (a, b) => {
    const as = a.split('/'), bs = b.split('/')
    if (as.length !== bs.length) return false
    return as.every((seg, i) => seg === bs[i] || seg.startsWith(':') || bs[i].startsWith(':'))
  }
  const routes = snapshot.map(r => ({ method: r.split(' ')[0], path: r.slice(r.indexOf(' ') + 1) }))
  for (let i = 0; i < routes.length; i++) {
    for (let j = i + 1; j < routes.length; j++) {
      if (routes[i].method !== routes[j].method) continue
      if (!matches(routes[i].path, routes[j].path)) continue
      assert.ok(params(routes[i].path) <= params(routes[j].path),
        `${routes[i].method} ${routes[j].path} must come before ${routes[i].path}`)
    }
  }
})
