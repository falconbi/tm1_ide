'use strict'
// TM1 REST keys live inside single quotes (Dimensions('…')). A name interpolated
// there must go through odataKey — encodeURIComponent leaves a literal apostrophe
// unescaped and breaks the OData key. Exempt lines with a comment explaining why.

const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const path = require('path')

const ROOT = path.join(__dirname, '..')
const files = []
function walk(p) {
    const st = fs.statSync(p)
    if (st.isDirectory()) {
        for (const e of fs.readdirSync(p)) walk(path.join(p, e))
    } else if (p.endsWith('.js')) files.push(p)
}
walk(path.join(ROOT, 'core'))
walk(path.join(ROOT, 'tools', 'tm1mcp'))
files.push(path.join(ROOT, 'server.js'))

const KEY_INTERPOLATION = /(?:^|[^A-Za-z0-9_])(?:Cubes|Dimensions|Hierarchies|Subsets|Views|Chores|Processes|Elements)\('\$\{/

test('TM1 keys interpolate odataKey (or say why not)', () => {
    const bad = []
    for (const file of files) {
        const text = fs.readFileSync(file, 'utf8')
        text.split('\n').forEach((line, i) => {
            if (KEY_INTERPOLATION.test(line) && !line.includes('odataKey(') && !line.includes('// odata-key: ok')) {
                bad.push(`${path.relative(ROOT, file)}:${i + 1}: ${line.trim()}`)
            }
        })
    }
    assert.deepEqual(bad, [], `TM1 key interpolated without odataKey:\n${bad.join('\n')}`)
})
