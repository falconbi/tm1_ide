'use strict'
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const path = require('path')
const guard = require('../tools/tm1mcp/guard')

test('the MCP docs state the actual read/write tool counts', () => {
    const doc = fs.readFileSync(path.join(__dirname, '..', 'docs', 'ide', 'MCP_SERVER.md'), 'utf8')
    const reads = guard.READ_TOOLS.size
    const writes = guard.WRITE_TOOLS.size
    assert.match(doc, new RegExp(`## Tool catalog \\(${reads + writes}: ${reads} read, ${writes} write\\)`))
    assert.match(doc, new RegExp(`${reads} read tools only`))
    assert.match(doc, new RegExp(`${writes} write tools`))
})
