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
// grouped by subject — 65 tools (39 read, 26 write; readonly mode offers only the
// reads). Security model: docs/ide/MCP_SERVER.md "Security".

require('dotenv').config({ path: require('path').join(__dirname, '../../.env') })

const { McpServer }            = require('@modelcontextprotocol/sdk/server/mcp.js')
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js')
const ctx                      = require('./shared')

// ── Server ────────────────────────────────────────────────────────────────────

const _server = new McpServer({
    name:    'tm1-ide',
    version: '2.0.0',
})

// Tool registration + the security wrapper (read/write classification, readonly
// mode, policy checks, reader/builder identity, read audit) live in registry.js.
const { registerAll, DEPLOY_CHECK_TOOLS } = require('./registry')
const { registered, skipped } = registerAll(_server, ctx, {
    mode:     ctx.MODE,
    policy:   ctx.policy,
    identity: ctx.identity,
    audit:    row => ctx.cl.writeReadAudit(row),
    explicitTargets: ctx.explicitTargets(),
})

// ── Start ─────────────────────────────────────────────────────────────────────

// Read audit retention: TM1_MCP_AUDIT_DAYS (default 90; 0 = keep forever).
// Pruned at start-up and once a day while running.
const AUDIT_DAYS = process.env.TM1_MCP_AUDIT_DAYS != null && process.env.TM1_MCP_AUDIT_DAYS !== ''
    ? Number(process.env.TM1_MCP_AUDIT_DAYS) : 90
if (!Number.isFinite(AUDIT_DAYS)) {
    process.stderr.write(`tm1mcp: TM1_MCP_AUDIT_DAYS must be a number of days (got "${process.env.TM1_MCP_AUDIT_DAYS}")\n`)
    process.exit(1)
}
function pruneAudit() { try { ctx.cl.pruneReadAudit(AUDIT_DAYS) } catch (e) { process.stderr.write(`tm1mcp: read-audit prune failed: ${e.message}\n`) } }

async function main() {
    // Prove the reader login before serving anything — a bad per-user login stops
    // here rather than surfacing as a confusing first tool error.
    const readerName = await ctx.identity.verifyReader()
    const builderName = await ctx.identity.builderClient().get('ActiveUser', { '$select': 'Name' }).then(u => u?.Name).catch(() => null)
    if (builderName) ctx.setBuilderLogin(builderName)
    pruneAudit()
    setInterval(pruneAudit, 86_400_000).unref()
    const transport = new StdioServerTransport()
    await _server.connect(transport)
    const checks = skipped.filter(t => DEPLOY_CHECK_TOOLS.has(t)).length
    const notOffered = [`${skipped.length - checks} write tools`, checks && `${checks} deploy checks — name target servers to offer them`].filter(Boolean).join(', ')
    const reads = readerName ? `as TM1 user "${readerName}" (TM1 security applies)` : 'as the service login (TM1 security does not narrow them — set TM1_MCP_READ_USER)'
    process.stderr.write(`tm1mcp: connected to "${ctx.SERVER}" — mode ${ctx.MODE}, ${registered.length} tools` +
        `${skipped.length ? ` (not offered: ${notOffered})` : ''}; reads ${reads}` +
        `${ctx.MODE === 'build' ? `; writes as ${builderName ? `"${builderName}"` : 'the service login'}` : '; read-only — set MCP_MODE=build to build'}\n`)
}

main().catch(e => {
    process.stderr.write(`tm1mcp: fatal: ${e.message}\n`)
    process.exit(1)
})
