'use strict'
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const path = require('path')
const guard = require('../tools/tm1mcp/guard')
const { buildTable } = require('../tools/tm1mcp/tool-table')

// A Windows checkout made before .gitattributes existed may hand us CRLF.
// Compare line-for-line content, not the line ending the platform chose.
function readDoc() {
    return fs.readFileSync(path.join(__dirname, '..', 'docs', 'ide', 'MCP_SERVER.md'), 'utf8')
        .replace(/\r\n/g, '\n')
}

test('the MCP docs state the actual read/write tool counts', () => {
    const doc = readDoc()
    const reads = guard.READ_TOOLS.size
    const writes = guard.WRITE_TOOLS.size
    assert.match(doc, new RegExp(`## Tool catalog \\(${reads + writes}: ${reads} read, ${writes} write\\)`))
    assert.match(doc, new RegExp(`${reads} read tools only`))
    assert.match(doc, new RegExp(`${writes} write tools`))
})

test('the generated tool inventory matches guard.js and registry.js', () => {
    const doc = readDoc()
    assert.ok(doc.includes(buildTable().replace(/\r\n/g, '\n')), 'run node tools/tm1mcp/tool-table.js --write')
    assert.doesNotMatch(doc, /69 tools|all 69/)
})
