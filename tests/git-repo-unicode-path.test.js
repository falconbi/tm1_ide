'use strict'
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { git } = require('../core/git-repo')

test('git output keeps non-ASCII paths unquoted', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'git-unicode-'))
  try {
    git(dir, 'init', '-q')
    const name = 'Cost by Position — Monthly test.json'
    fs.mkdirSync(path.join(dir, 'cubes'))
    fs.writeFileSync(path.join(dir, 'cubes', name), '{}')
    git(dir, 'add', '-A')
    git(dir, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', 'add')
    const files = git(dir, 'ls-files')
    assert.ok(files.includes(`cubes/${name}`), files)
    assert.ok(!files.includes('\\342'), 'path is not C-quoted')
  } finally { fs.rmSync(dir, { recursive: true, force: true }) }
})
