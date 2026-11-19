'use strict'
// Which TM1 groups may author Lenses, from config/servers.json ("lensAuthors"
// on the adminHost or connection). Absent means no restriction.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const path = require('path')

const SERVERS_PATH = path.join(__dirname, '..', 'config', 'servers.json')

function withServers(cfg, fn) {
  const real = { statSync: fs.statSync, readFileSync: fs.readFileSync }
  fs.statSync = (p, ...rest) => (p === SERVERS_PATH ? { mtimeMs: Math.random() } : real.statSync(p, ...rest))
  fs.readFileSync = (p, ...rest) => (p === SERVERS_PATH ? JSON.stringify(cfg) : real.readFileSync(p, ...rest))
  const mod = require.resolve('../core/adapter-registry')
  try { delete require.cache[mod]; return fn(require('../core/adapter-registry')) }
  finally { Object.assign(fs, real); delete require.cache[mod] }
}

test('lensAuthors reads the adminHost list, case as written', () => {
  withServers({ adminHosts: [{ name: 'Lab', servers: ['S1'], lensAuthors: ['Lens Authors', 'Finance'] }] }, reg => {
    assert.deepEqual(reg.lensAuthors('S1'), ['Lens Authors', 'Finance'])
    assert.deepEqual(reg.lensAuthors('unknown'), [])
  })
})

test('lensAuthors reads a connection list, and absent means no restriction', () => {
  withServers({ connections: [{ name: 'PAW', adapter: 'paw-native', servers: ['Prod'], lensAuthors: ['Lens Authors'] }] }, reg => {
    assert.deepEqual(reg.lensAuthors('Prod'), ['Lens Authors'])
  })
  withServers({ adminHosts: [{ name: 'Lab', servers: ['S1'] }] }, reg => {
    assert.deepEqual(reg.lensAuthors('S1'), [])
  })
})
