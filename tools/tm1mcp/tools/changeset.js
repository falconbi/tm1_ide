'use strict'

const { z } = require('zod')

// ══════════════════════════════════════════════════════════════════════════════
// CHANGE SET — the deployment-workflow gate
// ══════════════════════════════════════════════════════════════════════════════

function register(server, { SERVER, AGENT_USER, cl, assertions, runAssertions, ok, client }) {
    server.tool(
        'start_change_set',
        'Open a new change set on this server. Call this FIRST, before any model changes. Every create/update/delete is recorded against the open change set so it can be reviewed and deployed through the IDE pipeline.',
        {
            name: z.string().describe('Change set name — e.g. "AI: Working Capital model". Prefix with "AI:" so it is identifiable in the IDE.'),
        },
        async ({ name }) => {
            const existing = cl.getActiveSession(SERVER, AGENT_USER)
            if (existing) {
                return ok(`A change set is already open on "${SERVER}" for ${AGENT_USER}: "${existing.name}" (id ${existing.id}, started ${existing.started_at}). Close it first, or continue using it.`)
            }
            const s = cl.startSession(name, SERVER, AGENT_USER)
            return ok(`Change set opened: "${s.name}" (id ${s.id}) on server "${SERVER}". All subsequent model changes will be recorded here.`)
        }
    )

    server.tool(
        'close_change_set',
        'Close the open change set on this server. Do this when the model build is complete and ready for review. ' +
        'The same close sequence as the IDE is used (model-owned record first, then the local log). ' +
        'If the server has stored assertions, they are run and the result is included.',
        {},
        async () => {
            const s = cl.getActiveSession(SERVER, AGENT_USER)
            if (!s) return ok(`No change set is open on "${SERVER}" for ${AGENT_USER}.`)
            const entries = cl.getSessionLog(s.id)

            let tests = null
            let assertLine = ''
            const { assertions: storedAssertions } = await assertions.list(SERVER)
            if (storedAssertions.length) {
                const a = await runAssertions()
                tests = { passed: a.passed, total: a.total, blocking: a.failed.length }
                assertLine = `\nAssertions (from ${a.source}): ${a.passed}/${a.total} passing.`
                if (a.failed.length) {
                    assertLine += ' FAILING — ' + a.failed.map(f =>
                        `${f.description || f.id}: ${f.error ? `error (${f.error})` : `expected ${f.expected}, got ${f.actual}`}`
                    ).join(' | ')
                }
            }
            const { closeChangeSet } = require('../../../core/change-set-service')
            const { preCloseCheck, finalizeDevClose } = require('../../../core/close-check')
            let closeCheck
            try { closeCheck = await preCloseCheck(SERVER, s.id, { client: client() }) }
            catch (e) { closeCheck = { ok: true, warning: e.message } }
            if (closeCheck.ok === false) {
                return ok({
                    refused: `Cannot close: ${(closeCheck.stops ?? [closeCheck.error]).join('; ')}`,
                    stops: closeCheck.stops ?? [],
                    attributeTypeChanges: closeCheck.attributeTypeChanges ?? [],
                    deletedUsage: closeCheck.deletedUsage ?? [],
                })
            }
            await closeChangeSet(s.id, { user: AGENT_USER, tests, client: client() })
            let finalized
            try { finalized = await finalizeDevClose(SERVER, s.id, { user: AGENT_USER }) } catch (e) { finalized = { ok: false, error: e.message } }

            // Overlap warning: another open change set touched the same objects.
            let overlapLine = ''
            try {
                const touches = cl.getCrossSessionTouches(SERVER, s.id, entries)
                if (touches.length) {
                    overlapLine = '\n⚠ OVERLAP — these objects were also touched in another change set (its edits are on DEV now and will ride along): ' +
                        touches.map(t => `${t.object_type} "${t.object_name}" (${t.touchedBy} in "${t.sessionName}")`).join(' | ') +
                        '\nDecide: ship both together, or coordinate so the shared objects are consistent.'
                }
            } catch { /* overlap is advisory */ }

            return ok(`Change set "${s.name}" (id ${s.id}) closed with ${entries.length} object change(s).${assertLine}${overlapLine}` +
                `${finalized?.commit ? `\nDEV After Close: ${finalized.commit}.` : finalized?.error ? `\nDEV After Close failed: ${finalized.error}` : ''}\n` +
                `Next: pre_deploy_check, then Build Release in the IDE. Deploy is a human step.`)
        }
    )

    server.tool(
        'get_change_set',
        'Show the open change set and every object change recorded in it so far',
        {},
        async () => {
            const s = cl.getActiveSession(SERVER, AGENT_USER)
            if (!s) return ok(`No change set is open on "${SERVER}" for ${AGENT_USER}. Call start_change_set to begin.`)
            const entries = cl.getSessionLog(s.id)
            const grouped = {}
            for (const e of entries) {
                (grouped[e.object_type] ??= []).push({ action: e.action, name: e.object_name, detail: e.detail })
            }
            return ok({ change_set: { id: s.id, name: s.name, started_at: s.started_at }, object_count: entries.length, changes: grouped })
        }
    )
}

module.exports = { register }
