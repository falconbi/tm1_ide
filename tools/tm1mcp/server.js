#!/usr/bin/env node
'use strict'

// tm1mcp — MCP server exposing TM1 model context and dev tools to AI agents
// Usage:  node tools/tm1mcp/server.js --server <name>
// Claude: claude mcp add tm1 -- node /path/to/tools/tm1mcp/server.js --server 24Retail
//
// Model-building tools (build_dimension, build_cube, build_process, …) and every
// other metadata write require an open change set — call start_change_set first.
// All writes are logged to change_log.db so they surface in the IDE deploy pipeline
// (diff → package → risk → deploy) exactly like changes made in the IDE itself.
//
// This file is just the bootstrap: shared context (shared.js), server setup, wire
// each tool group, connect. Tool registrations themselves live in tools/*.js,
// grouped by subject — same 60 tools, same names, same behavior as before the
// split; only where the code lives changed.

require('dotenv').config({ path: require('path').join(__dirname, '../../.env') })

const { McpServer }            = require('@modelcontextprotocol/sdk/server/mcp.js')
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js')
const ctx                      = require('./shared')

// ── Server ────────────────────────────────────────────────────────────────────

const _server = new McpServer({
    name:    'tm1-ide',
    version: '2.0.0',
})

// Wrap every tool handler so TM1/OData error detail reaches the agent instead of
// the opaque "Request failed with status code 400".
const server = {
    tool(name, description, schema, handler) {
        return _server.tool(name, description, schema, async (args) => {
            try {
                return await handler(args)
            } catch (e) {
                const d = e.response?.data?.error?.message ?? e.response?.data?.error ?? e.response?.data
                const msg = typeof d === 'string' ? d : d ? JSON.stringify(d) : e.message
                return { content: [{ type: 'text', text: `Error: ${msg}` }], isError: true }
            }
        })
    },
}

// ── Tool groups ───────────────────────────────────────────────────────────────

require('./tools/docs').register(server, ctx)          // read_build_guide
require('./tools/introspect').register(server, ctx)     // list_*/get_*/find_cubes_using_dimension — model context, read-only
require('./tools/changeset').register(server, ctx)       // seed/list/set_baseline, start/close/get/diff/package_change_set
require('./tools/assertions').register(server, ctx)      // add/list/remove/run_assertions
require('./tools/deploy').register(server, ctx)          // check_deploy_risk, check_target_drift
require('./tools/build').register(server, ctx)           // build_*/add_elements/create_*/set_attribute_values/write_cells/read_cells/delete_object
require('./tools/develop').register(server, ctx)         // update_cube_rules/update_process/run_process/check_rules_syntax/check_feeders/trace_feeders
require('./tools/diagnostics').register(server, ctx)     // logs, threads, transaction log, usage-finders, search_ti_code

// ── Start ─────────────────────────────────────────────────────────────────────

async function main() {
    const transport = new StdioServerTransport()
    await _server.connect(transport)
    process.stderr.write(`tm1mcp: connected to "${ctx.SERVER}"\n`)
}

main().catch(e => {
    process.stderr.write(`tm1mcp: fatal: ${e.message}\n`)
    process.exit(1)
})
