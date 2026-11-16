'use strict'

const { z } = require('zod')
const guard = require('../guard')

// ══════════════════════════════════════════════════════════════════════════════
// ASSERTIONS
// ══════════════════════════════════════════════════════════════════════════════

function register(server, { client, assertions, runAssertions, ok, SERVER, AGENT_USER, policy, logChange }) {
    server.tool(
        'add_assertion',
        'Record an expected result for this model — an MDX query and the number it should return. ' +
        'Stored in the model\'s governance store and run on every close_change_set, plus on demand via run_assertions. ' +
        'Ground rules: test the END of the logic (a real calc/consolidation output). kind="behaviour" = a specific value ' +
        'that depends on the data (runs on DEV); kind="control" = a rule that must hold on any data (runs on DEV and PROD). ' +
        'severity="block" = must stop a Close/deploy; "warn" = data-sensitive (e.g. actual-vs-forecast is always warn — never block). ' +
        'Give a plain `description` (what) and `why` (the rule/intent it protects). It does not require an open change set; the write is logged.',
        {
            description: z.string().describe('What this checks, in words — e.g. "IT pool clears: total DR = pool"'),
            why:         z.string().optional().describe('Why this test exists — the rule or intent it protects'),
            mdx:         z.string().describe('MDX SELECT. Returned cells are summed and compared to `expected`.'),
            expected:    z.number().describe('The value the summed cells should equal'),
            tolerance:   z.number().optional().describe('Absolute tolerance (default 0.01)'),
            tags:        z.array(z.string()).optional().describe('Labels for running a subset later'),
            kind:        z.enum(['behaviour', 'control']).optional().describe('behaviour = a specific value on DEV; control = a rule that must hold (DEV + PROD)'),
            severity:    z.enum(['block', 'warn']).optional().describe('block = stops a Close/deploy; warn = just flags (data-sensitive)'),
        },
        async ({ description, mdx, expected, tolerance, tags, kind, severity, why }) => {
            const cl = require('../../../core/change_log')
            const sess = cl.getActiveSession(SERVER, AGENT_USER)
            const rec = await assertions.add(SERVER, { description, mdx, expected, tolerance, tags, kind, severity, why, author: AGENT_USER, changeSet: sess?.id ?? null })
            logChange('ASSERTION_ADDED', 'assertion', rec.id, { detail: { description, expected, tolerance, kind, severity, changeSet: sess?.id ?? null } })
            return ok({
                added: rec.id,
                next: `run_assertions with ids: [${rec.id}] to check it`,
            })
        }
    )

    server.tool(
        'list_assertions',
        'List the stored assertions for this server — with `source`: "model" when read from the server\'s own ' +
        'Applications/Governance/Tests/assertions.json, "config" when falling back to config/assertions.json',
        {},
        async () => {
            const { source, assertions: stored } = await assertions.list(SERVER)
            const visible = stored.map(a => guard.cubesInMdx(a.mdx).some(cube => !guard.allowed(policy, 'cubes', cube))
                ? { id: a.id, description: a.description, tags: a.tags ?? [], status: 'not visible', mdx: null }
                : a)
            return ok({ source, assertions: visible })
        }
    )

    server.tool(
        'remove_assertion',
        'Delete a stored assertion by id. It does not require an open change set; the write is logged',
        { id: z.string().describe('Assertion id (from add_assertion or list_assertions)') },
        async ({ id }) => {
            const removed = await assertions.remove(SERVER, id)
            if (removed) logChange('ASSERTION_REMOVED', 'assertion', id, { detail: { changeSet: null } })
            return ok(removed ? `Removed assertion ${id}.` : `No assertion ${id} for "${SERVER}".`)
        }
    )

    server.tool(
        'run_assertions',
        'Run the stored assertions now — execute each MDX, sum the cells, compare to expected. ' +
        'Use this to self-check a build before closing the change set.',
        {
            tags: z.array(z.string()).optional().describe('Run only assertions with one of these tags'),
            ids:  z.array(z.string()).optional().describe('Run only these assertion ids (for example the id returned by add_assertion)'),
        },
        async ({ tags, ids }) => {
            const { source, assertions: set } = await assertions.list(SERVER)
            if (!set.length) return ok(`No assertions stored for "${SERVER}" (source: ${source}). Add them with add_assertion.`)
            return ok(await runAssertions(tags, ids))
        }
    )
}

module.exports = { register }
