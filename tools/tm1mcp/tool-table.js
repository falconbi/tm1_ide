'use strict'

// Generate the flat MCP tool inventory in docs/ide/MCP_SERVER.md from the
// classification in guard.js and the gate/identity rules in registry.js.
// Run: node tools/tm1mcp/tool-table.js --write

const fs = require('fs')
const path = require('path')
const guard = require('./guard')
const { UNGATED_WRITE_TOOLS } = require('./registry')

const DOC = path.join(__dirname, '..', '..', 'docs', 'ide', 'MCP_SERVER.md')
const START = '<!-- BEGIN GENERATED TOOL TABLE -->'
const END = '<!-- END GENERATED TOOL TABLE -->'

function buildTable() {
    const rows = [
        ...[...guard.READ_TOOLS].sort().map(name => ({ name, kind: 'read', gate: '—', identity: 'reader' })),
        ...[...guard.WRITE_TOOLS].sort().map(name => ({
            name,
            kind: 'write',
            gate: UNGATED_WRITE_TOOLS.has(name) ? 'ungated' : 'change set',
            identity: 'builder',
        })),
    ]
    return [
        START,
        `| Tool | Class | Gate | Identity |`,
        `|---|---|---|---|`,
        ...rows.map(r => `| \`${r.name}\` | ${r.kind} | ${r.gate} | ${r.identity} |`),
        END,
    ].join('\n')
}

function main() {
    if (!process.argv.includes('--write')) {
        process.stdout.write(buildTable() + '\n')
        return
    }
    const doc = fs.readFileSync(DOC, 'utf8')
    const before = doc.indexOf(START)
    const after = doc.indexOf(END)
    if (before < 0 || after < 0 || after < before) throw new Error(`generated table markers not found in ${DOC}`)
    const next = doc.slice(0, before) + buildTable() + doc.slice(after + END.length)
    fs.writeFileSync(DOC, next)
    process.stderr.write(`updated ${path.relative(process.cwd(), DOC)}\n`)
}

if (require.main === module) main()

module.exports = { buildTable, DOC }
