'use strict'

// Test harness for the MCP security tests: registers every real tool group
// against a fake MCP server and a fake context (no TM1, no bound server), so a
// test can list what got registered and call any handler with a fake TM1 client.

const { registerAll } = require('../tools/tm1mcp/registry')
const { createIdentity } = require('../tools/tm1mcp/identity')
const guard = require('../tools/tm1mcp/guard')

function ok(data) {
    return { content: [{ type: 'text', text: typeof data === 'string' ? data : JSON.stringify(data, null, 2) }] }
}

// fakeTm1(name, overrides) → a TM1Client stand-in that records each call made on it.
function fakeTm1(name, overrides = {}) {
    const calls = []
    const base = {
        who: name, calls,
        async get(p) { calls.push(['get', p]); return { value: [] } },
        async post(p) { calls.push(['post', p]); return {} },
        async getModelCubes() { calls.push(['getModelCubes']); return [{ Name: 'Sales' }, { Name: 'Payroll' }] },
        async getModelDimensions() { calls.push(['getModelDimensions']); return [{ Name: 'Region' }, { Name: '}Clients' }] },
        async getProcesses() { calls.push(['getProcesses']); return [] },
        async getCube(n) { calls.push(['getCube', n]); return { Name: n, Dimensions: [] } },
        async getElementsWithTree(d) { calls.push(['getElementsWithTree', d]); return [] },
    }
    return Object.assign(base, overrides)
}

function setup({ mode = 'build', policyRaw = {}, env = {}, builder, reader, server = 'TestSrv', explicitTargets = false, cl, assertions } = {}) {
    const policy = guard.buildPolicy(policyRaw, server)
    const b = builder ?? fakeTm1('builder')
    const identity = createIdentity({
        server, env,
        makeClient: () => b,
        makeClientWithCredentials: (_s, creds) => (reader === null ? null : reader ?? fakeTm1(`reader:${creds.username}`)),
    })
    const audit = []
    const changes = []
    const ctx = {
        SERVER: server, AGENT_USER: 'dev-test', MODE: mode, policy, identity,
        client: () => identity.client(), ok, esc: s => s,
        logChange: (...a) => changes.push(a),
        requireWritable() {}, requireChangeSet() { return { id: 'cs' } },
        runAssertions: async () => ({}), assertTargetAllowed() {}, targetAllowlist: () => new Set([server]),
        cl: cl ?? { getActiveSession: () => null, writeLog: () => ({}) },
        assertions: assertions ?? {}, lintRules: () => ({ errors: [], warnings: [] }), lintTI: () => ({ errors: [], warnings: [] }),
    }
    const handlers = {}
    const mcp = { tool(name, _d, _s, fn) { handlers[name] = fn } }
    const { registered, skipped } = registerAll(mcp, ctx, { mode, policy, identity, audit: r => audit.push(r), explicitTargets })
    const call = async (name, args = {}) => {
        const res = await handlers[name](args)
        const text = res.content[0].text
        let data = text
        try { data = JSON.parse(text) } catch { /* plain text */ }
        return { res, text, data, isError: !!res.isError }
    }
    return { ctx, handlers, registered, skipped, audit, changes, call, identity, builder: b }
}

module.exports = { setup, fakeTm1 }
