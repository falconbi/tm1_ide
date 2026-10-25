#!/usr/bin/env node
'use strict'

// Save Workforce Lenses from this folder back into TM1 with the MCP save_lens tool.
//   node lenses/workforce/save.js            save every page
//   node lenses/workforce/save.js WFP-Home   save one page
//
// The files are lenses/workforce/pages/<name>.html + <name>.json. The JSON is the
// metadata/config from get_lens (without html). After saving, the script reads the
// Lens back with get_lens and prints the version from that read.

const fs = require('fs')
const path = require('path')

const ROOT = path.resolve(__dirname, '../..')
const PAGES = path.join(__dirname, 'pages')
const arg = process.argv[2]

if (arg === '--help' || arg === '-h') {
    console.log('Save Workforce Lenses from lenses/workforce/pages into TM1.')
    console.log('  node lenses/workforce/save.js           save every page')
    console.log('  node lenses/workforce/save.js WFP-Home  save one page')
    console.log('Needs an open change set on the target server.')
    process.exit(0)
}

process.chdir(ROOT)
process.env.TM1_MCP_SERVER = process.env.TM1_MCP_SERVER || 'TM1_Test_DEV'
process.env.MCP_MODE = process.env.MCP_MODE || 'build'
process.env.TM1_MCP_USER = process.env.TM1_MCP_USER || 'admin'
process.argv.push('--server', process.env.TM1_MCP_SERVER)

// The MCP tools, registered in-process exactly as the MCP server does.
const ctx = require('../../tools/tm1mcp/shared')
const { registerAll } = require('../../tools/tm1mcp/registry')
const h = {}
registerAll(
    { tool(name, _desc, _schema, fn) { h[name] = fn } },
    ctx,
    { mode: ctx.MODE, policy: ctx.policy, identity: ctx.identity, audit: r => ctx.cl.writeReadAudit(r) }
)

function usageError(msg) {
    console.error(msg)
    process.exit(1)
}

;(async () => {
    let files = fs.readdirSync(PAGES).filter(f => f.endsWith('.html')).sort()
    if (arg) {
        const wanted = path.basename(arg, '.html')
        files = files.filter(f => path.basename(f, '.html') === wanted)
        if (!files.length) usageError(`No page "${wanted}" in ${PAGES}`)
    }
    if (!files.length) usageError(`No pages in ${PAGES}`)

    let failed = 0
    let warnedImage = false
    for (const file of files) {
        const name = path.basename(file, '.html')
        const htmlPath = path.join(PAGES, file)
        const jsonPath = path.join(PAGES, name + '.json')
        if (!fs.existsSync(jsonPath)) { console.error(`${name}: missing ${name}.json`); failed++; continue }

        const meta = JSON.parse(fs.readFileSync(jsonPath, 'utf8'))
        if (meta.name && meta.name !== name) { console.error(`${name}: JSON name is "${meta.name}"`); failed++; continue }
        if (!warnedImage && meta.image) {
            console.warn('Note: save_lens has no image field; the image value is kept in the JSON but not sent.')
            warnedImage = true
        }

        try {
            const result = JSON.parse((await h.save_lens({
                name,
                html: fs.readFileSync(htmlPath, 'utf8'),
                title: meta.title,
                description: meta.description,
                folder: meta.folder,
                icon: meta.icon,
                color: meta.color,
                config: meta.config,
                publish: meta.status === 'published',
            })).content[0].text)

            if (result.blocked) {
                console.error(`${name}: BLOCKED — ${result.reason || 'validation failed'}`)
                ;(result.errors || []).slice(0, 10).forEach(e => console.error('  ' + JSON.stringify(e)))
                failed++
                continue
            }
        } catch (e) {
            console.error(`${name}: ${e.message}`)
            failed++
            continue
        }

        // Read back: the printed version is the stored one, not the save message.
        const read = JSON.parse((await h.get_lens({ name })).content[0].text)
        console.log(`saved ${name} — version ${read.version}`)
    }

    if (failed) {
        console.error(`${failed} page(s) failed`)
        process.exit(1)
    }
})().catch(e => {
    console.error(e.message)
    process.exit(1)
})
