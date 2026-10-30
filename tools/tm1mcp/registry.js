'use strict'

// ── Tool registration, with the security wrapper ─────────────────────────────
// Every tool goes through toolServer().tool(), which:
//   - classifies it (guard.classify — an unclassified tool stops start-up)
//   - in readonly mode, does not register write tools at all (the agent never
//     sees them in the tool list, so there is nothing to talk it into calling)
//   - read tools: checks the named cube / dimension / process / MDX cubes against
//     the policy, runs the handler as the READER identity, audits the call
//   - write tools: run as the BUILDER identity; the read-only server check for the
//     ones that don't go through requireChangeSet() (unchanged from before)
//   - turns TM1/OData errors into readable text for the agent
//
// Kept apart from server.js (which binds a real server and connects stdio) so the
// tests can register every tool against a fake MCP server and fake context.

const guard = require('./guard')

// Write tools that change the bound server WITHOUT opening a change set, so the
// read-only check is applied here instead (the rest call requireChangeSet()):
//   start_change_set   — opening a build session against a read-only server is refused too
//   run_process, reprocess_feeders — execute TI; no change-set entry of their own
//   save_data_all — server operation; no change-set entry of its own
//   add_assertion, remove_assertion — write the model's assertions document
// Deploy execution is not an MCP tool; check_deploy_risk / check_target_drift only read.
const UNGATED_WRITE_TOOLS = new Set(['start_change_set', 'run_process', 'reprocess_feeders', 'save_data_all', 'add_assertion', 'remove_assertion'])

// The deploy checks open a connection to ANOTHER server (possibly production) with
// that server's service login, outside the reader's TM1 security. In readonly mode
// they are offered only when target servers were named on purpose
// (TM1_MCP_ALLOWED_TARGETS or "mcpAllowTargets" in config/servers.json).
const DEPLOY_CHECK_TOOLS = new Set(['check_deploy_risk', 'check_target_drift'])

const GROUPS = ['docs', 'introspect', 'changeset', 'assertions', 'deploy', 'build', 'develop', 'period', 'coreti', 'diagnostics', 'lenses']

function errorText(e) {
    const d = e.response?.data?.error?.message ?? e.response?.data?.error ?? e.response?.data
    return typeof d === 'string' ? d : d ? JSON.stringify(d) : e.message
}

// The JSON a tool answered with (ok() wraps it as text), for the audit row count.
function _payload(res) {
    const t = res?.content?.[0]?.text
    if (typeof t !== 'string') return null
    try { return JSON.parse(t) } catch { return t }
}

// Every write answer names the server it ran on, so a wrong server is seen at once — as its
// own trailing text block, so the answer itself (often JSON) still parses as it did.
function _stampServer(res, server) {
    const c = res?.content
    if (!Array.isArray(c) || !server) return res
    return { ...res, content: [...c, { type: 'text', text: `[ran on ${server}]` }] }
}

function toolServer(mcp, ctx, { mode, policy, identity, audit, explicitTargets = false }) {
    const registered = [], skipped = []
    const who = () => identity.describe()

    function record(name, args, outcome, extra = {}) {
        audit({
            server:   ctx.SERVER,
            user:     ctx.AGENT_USER,
            identity: who().reader,
            tool:     name,
            object:   guard.objectOf(args),
            outcome,
            ...extra,
        })
    }

    return {
        registered, skipped,
        tool(name, description, schema, handler) {
            const kind = guard.classify(name)
            if (mode === 'readonly' && kind === 'write') { skipped.push(name); return null }
            if (mode === 'readonly' && DEPLOY_CHECK_TOOLS.has(name) && !explicitTargets) { skipped.push(name); return null }
            registered.push({ name, kind })

            async function run(args) {
                if (kind === 'read') {
                    try { guard.checkArgs(policy, args) }
                    catch (e) {
                        record(name, args, 'refused', { detail: e.message })
                        return { content: [{ type: 'text', text: `Error: ${e.message}` }], isError: true }
                    }
                }
                try {
                    if (kind === 'write') {
                        if (UNGATED_WRITE_TOOLS.has(name)) ctx.requireWritable()
                        return _stampServer(await identity.asBuilder(() => handler(args)), ctx.SERVER)
                    }
                    const res = await identity.asReader(() => handler(args))
                    const data = _payload(res)
                    record(name, args, res?.isError ? 'error' : 'ok', {
                        rows:     guard.countRows(data),
                        redacted: data && typeof data === 'object' ? data.redacted ?? null : null,
                    })
                    return res
                } catch (e) {
                    const msg = errorText(e)
                    if (kind === 'read') record(name, args, /blocked by config\/mcp-security/.test(msg) ? 'refused' : 'error', { detail: msg })
                    return { content: [{ type: 'text', text: `Error: ${msg}` }], isError: true }
                }
            }

            // Passwords are stripped from EVERY answer, whatever the tool (guard.scrubResult).
            return mcp.tool(name, description, schema, async (args = {}) => guard.scrubResult(await run(args)))
        },
    }
}

// Register every tool group on `mcp`. Returns { registered, skipped }.
function registerAll(mcp, ctx, opts) {
    const server = toolServer(mcp, ctx, opts)
    for (const g of GROUPS) require(`./tools/${g}`).register(server, ctx)
    return { registered: server.registered, skipped: server.skipped }
}

module.exports = { registerAll, toolServer, UNGATED_WRITE_TOOLS, DEPLOY_CHECK_TOOLS, GROUPS }
