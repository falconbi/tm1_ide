'use strict'
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')
const log = require('../core/lens-activity-log')

test('the activity log rotates once past its size cap, keeping one previous file', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lens-log-'))
  const file = path.join(dir, 'activity.jsonl')
  fs.writeFileSync(file, 'x'.repeat(log.MAX_BYTES + 1))
  log.logLensWrite({ server: 'S', app: 'lens', user: 'u', lens: 'L', cube: 'C', changes: [] }, file)
  assert.ok(fs.existsSync(file + '.1'), 'the old file is kept as .1')
  assert.ok(fs.statSync(file + '.1').size > log.MAX_BYTES)
  assert.equal(log.readLensActivity({ server: 'S', lens: 'L' }, file).length, 0, 'the new file starts clean')
})
