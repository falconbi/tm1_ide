'use strict'

// Shared context for every tm1mcp tool-group module — TM1 client factory, the
// active-server config, and the handful of helpers every group needs (logging
// a change, formatting a response, running stored assertions, gating on an
// open change set). One place, no duplication across tools/*.js.

const { makeClient, makeClientWithCredentials, isReadOnly } = require('../../core/adapter_registry')
const { createIdentity } = require('./identity')
const guard           = require('./guard')
const cl              = require('../../core/change_log')
const { lintRules }   = require('../../core/rules-lint')
const { lintTI }      = require('../../core/ti-lint')
const assertions      = require('../../core/assertions')

// ── Config ────────────────────────────────────────────────────────────────────

// Which TM1 server this session works on: --server, else TM1_MCP_SERVER, else the
// server the IDE has selected (config/forge.json). No hard-coded fallback — a stale
// default once left the MCP aimed at the consolidation server while the work was on
// another model, so a write could have landed on the wrong one.
function ideServer() {
    try { return require('../../config/forge.json').server || null } catch { return null }
}
const args   = process.argv.slice(2)
const srvIdx = args.indexOf('--server')
const [SERVER, SERVER_SOURCE] =
      srvIdx !== -1                 ? [args[srvIdx + 1], '--server']
    : process.env.TM1_MCP_SERVER    ? [process.env.TM1_MCP_SERVER, 'TM1_MCP_SERVER']
    : ideServer()                   ? [ideServer(), 'the IDE (config/forge.json)']
    :                                 [null, null]

if (!SERVER) {
    process.stderr.write('tm1mcp: no server — select one in the IDE, or pass --server <name> / set TM1_MCP_SERVER\n')
    process.exit(1)
}
process.stderr.write(`tm1mcp: server ${SERVER} (from ${SERVER_SOURCE})\n`)

// The developer's identity. Override with TM1_MCP_USER so an agent's changes land
// in that developer's own change set (per-person change sets on a shared DEV),
// instead of all landing under a fixed 'ai-agent'.
const AGENT_USER = process.env.TM1_MCP_USER || 'ai-agent'

// readonly | build (MCP_MODE) — readonly registers no write tools at all.
const MODE = guard.resolveMode(process.env.MCP_MODE, isReadOnly(SERVER))

// What an agent may read here, and what is masked (config/mcp-security.json).
const policy = guard.loadPolicy(SERVER)

// Reads run as the reader (TM1_MCP_READ_USER → TM1's own security applies);
// writes as the builder (service login). See identity.js.
const identity = createIdentity({ server: SERVER, makeClient, makeClientWithCredentials })

// The builder's TM1 login name, filled in at start-up — recorded on every change-set row.
let builderLogin = null
function setBuilderLogin(name) { builderLogin = name }

// ── Helpers ───────────────────────────────────────────────────────────────────

// The TM1 client for the current call — the reader inside a read tool, the
// builder inside a write tool (the wrapper in registry.js decides).
function client() { return identity.client() }

function ok(data) {
    return { content: [{ type: 'text', text: typeof data === 'string' ? data : JSON.stringify(data, null, 2) }] }
}

const { odataKey } = require('../../core/odata-key')

// Every TM1 path in the MCP tools goes through this one encoder — it doubles a
// `'` for the OData key literal and percent-encodes the rest (% # ? & + space).
const esc = odataKey

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
        user:        AGENT_USER,
        identity:    builderLogin ?? 'service login',
    })
}

// Run the server's stored assertions: execute each MDX, sum the returned cells,
// compare to the expected value within tolerance.
async function runAssertions(tags) {
    const { source, assertions: stored } = await assertions.list(SERVER)
    const set = stored.filter(a => !tags?.length || a.tags.some(t => tags.includes(t)))
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
        source,
        total:  results.length,
        passed: results.filter(r => r.pass).length,
        failed: results.filter(r => !r.pass),
        results,
    }
}

// A server marked read-only (PROD posture) in config/servers.json takes no writes
// from an agent — the same rule the IDE's own write routes enforce.
function requireWritable() {
    if (isReadOnly(SERVER)) {
        throw new Error(`"${SERVER}" is read-only (PROD posture) — no changes are allowed here. Bind the MCP server to a writable server to build.`)
    }
}

// Metadata writes are refused unless a change set is open — this is the workflow gate.
function requireChangeSet() {
    requireWritable()
    const s = cl.getActiveSession(SERVER, AGENT_USER)
    if (!s) {
        throw new Error(
            'No change set is open for this server. Call start_change_set first — every model ' +
            'change must be captured in a change set so it can be reviewed and deployed.'
        )
    }
    return s
}

// ── Target allowlist for the read-only check tools ────────────────────────────
// check_deploy_risk / check_target_drift accept any `target` name and would
// otherwise open a read connection to whatever server the AI names — including
// PROD. Refuse any target not in: the bound SERVER ∪ TM1_MCP_ALLOWED_TARGETS
// (comma-separated env override) ∪ config/servers.json "mcpAllowTargets".
function targetAllowlist() {
    const set = new Set([SERVER])
    const env = process.env.TM1_MCP_ALLOWED_TARGETS
    if (env) env.split(',').map(s => s.trim()).filter(Boolean).forEach(t => set.add(t))
    try {
        const extra = require('../../config/servers.json')?.mcpAllowTargets
        if (Array.isArray(extra)) extra.forEach(t => set.add(t))
    } catch { /* config missing — bound server + env only */ }
    return set
}

// Were target servers named on purpose (beyond the bound server itself)?
function explicitTargets() {
    const set = targetAllowlist()
    set.delete(SERVER)
    return set.size > 0
}

function assertTargetAllowed(target) {
    const allowed = targetAllowlist()
    if (!allowed.has(target)) {
        throw new Error(
            `Target server "${target}" is not in the MCP target allowlist. Allowed: ${[...allowed].join(', ')}. ` +
            'Add it via TM1_MCP_ALLOWED_TARGETS (comma-separated env var) or the "mcpAllowTargets" key in config/servers.json.'
        )
    }
}

module.exports = { SERVER, SERVER_SOURCE, AGENT_USER, MODE, policy, identity, setBuilderLogin, client, ok, esc, logChange, runAssertions, requireWritable, requireChangeSet, assertTargetAllowed, targetAllowlist, explicitTargets, cl, assertions, lintRules, lintTI }
