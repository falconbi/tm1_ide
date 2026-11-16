'use strict'
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const path = require('path')

const ROOT = path.join(__dirname, '..', 'client', 'src')
const ALLOW = path.join(ROOT, 'lib', 'api.js')

function files(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => {
    const p = path.join(dir, e.name)
    return e.isDirectory() ? files(p) : (/\.(js|jsx)$/.test(e.name) ? [p] : [])
  })
}

test('the client calls the server through lib/api or hooks, never raw fetch', () => {
  const bad = []
  for (const file of files(ROOT)) {
    if (file === ALLOW) continue
    const lines = fs.readFileSync(file, 'utf8').split('\n')
    lines.forEach((line, i) => {
      const code = line.replace(/\/\/.*/, '')
      if (/(^|[^\w.$])fetch\(/.test(code)) bad.push(`${path.relative(ROOT, file)}:${i + 1}`)
    })
  }
  assert.deepEqual(bad, [])
})
