'use strict'

// Shared context for every tm1mcp tool-group module — TM1 client factory, the
// active-server config, and the handful of helpers every group needs (logging
// a change, formatting a response, running stored assertions, gating on an
// open change set). One place, no duplication across tools/*.js.

const { makeClient } = require('../../core/adapter_registry')
const cl              = require('../../core/change_log')
const { lintRules }   = require('../../core/rules-lint')
const { lintTI }      = require('../../core/ti-lint')
const assertions      = require('../../core/assertions')

// ── Config ────────────────────────────────────────────────────────────────────

const args   = process.argv.slice(2)
const srvIdx = args.indexOf('--server')
const SERVER = srvIdx !== -1 ? args[srvIdx + 1] : (process.env.TM1_MCP_SERVER ?? null)

if (!SERVER) {
    process.stderr.write('tm1mcp: specify a server with --server <name> or TM1_MCP_SERVER env var\n')
    process.exit(1)
}

const AGENT_USER = 'ai-agent'

// ── Helpers ───────────────────────────────────────────────────────────────────

function client() { return makeClient(SERVER, null) }

function ok(data) {
    return { content: [{ type: 'text', text: typeof data === 'string' ? data : JSON.stringify(data, null, 2) }] }
}

const esc = s => encodeURIComponent(s)

// Every metadata write goes through here so it lands in the active change set.
function logChange(action, objectType, objectName, opts = {}) {
    return cl.writeLog({
        server:      SERVER,
        action,
        objectType,
        objectName,
        detail:      opts.detail ?? null,
        beforeState: opts.before ?? null,
        afterState:  opts.after  ?? null,
    })
}

// Run the server's stored assertions: execute each MDX, sum the returned cells,
// compare to the expected value within tolerance.
async function runAssertions(tags) {
    const set = assertions.list(SERVER).filter(a => !tags?.length || a.tags.some(t => tags.includes(t)))
    const c = client()
    const results = []
    for (const a of set) {
        let actual = null, error = null
        try {
            const r = await c.executeMDX(a.mdx, 5000)
            actual = (r.Cells ?? []).reduce((s, x) => s + (x.Value ?? 0), 0)
        } catch (e) {
            error = e.response?.data?.error?.message ?? e.message
        }
        const pass = error == null && Math.abs(actual - a.expected) <= a.tolerance
        results.push({
            id: a.id, description: a.description,
            expected: a.expected, actual, diff: error ? null : actual - a.expected,
            pass, error,
        })
    }
    return {
        total:  results.length,
        passed: results.filter(r => r.pass).length,
        failed: results.filter(r => !r.pass),
        results,
    }
}

// Metadata writes are refused unless a change set is open — this is the workflow gate.
function requireChangeSet() {
    const s = cl.getActiveSession(SERVER)
    if (!s) {
        throw new Error(
            'No change set is open for this server. Call start_change_set first — every model ' +
            'change must be captured in a change set so it can be reviewed and deployed.'
        )
    }
    return s
}

module.exports = { SERVER, AGENT_USER, client, ok, esc, logChange, runAssertions, requireChangeSet, cl, assertions, lintRules, lintTI }
