'use strict'

const { z } = require('zod')

// ══════════════════════════════════════════════════════════════════════════════
// ASSERTIONS
// ══════════════════════════════════════════════════════════════════════════════

function register(server, { client, assertions, runAssertions, ok, SERVER, AGENT_USER }) {
    server.tool(
        'add_assertion',
        'Record an expected result for this model — an MDX query and the number it should return. ' +
        'Stored in the model\'s governance store and run on every close_change_set, plus on demand via run_assertions. ' +
        'Ground rules: test the END of the logic (a real calc/consolidation output). kind="behaviour" = a specific value ' +
        'that depends on the data (runs on DEV); kind="control" = a rule that must hold on any data (runs on DEV and PROD). ' +
        'severity="block" = must stop a Close/deploy; "warn" = data-sensitive (e.g. actual-vs-forecast is always warn — never block). ' +
        'Give a plain `description` (what) and `why` (the rule/intent it protects). It is executed once immediately so you know the query and expected value are right.',
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
            let actual = null, error = null
            try {
                const r = await client().executeMDX(mdx, 5000)
                actual = (r.Cells ?? []).reduce((s, x) => s + (x.Value ?? 0), 0)
            } catch (e) { error = e.response?.data?.error?.message ?? e.message }
            const pass = error == null && Math.abs(actual - rec.expected) <= rec.tolerance
            return ok({
                added: rec.id,
                check_now: error ? { error } : { actual, expected: rec.expected, pass },
            })
        }
    )

    server.tool(
        'list_assertions',
        'List the stored assertions for this server — with `source`: "model" when read from the server\'s own ' +
        'Applications/Governance/Tests/assertions.json, "config" when falling back to config/assertions.json',
        {},
        async () => ok(await assertions.list(SERVER))
    )

    server.tool(
        'remove_assertion',
        'Delete a stored assertion by id',
        { id: z.string().describe('Assertion id (from add_assertion or list_assertions)') },
        async ({ id }) => ok(await assertions.remove(SERVER, id) ? `Removed assertion ${id}.` : `No assertion ${id} for "${SERVER}".`)
    )

    server.tool(
        'run_assertions',
        'Run the stored assertions now — execute each MDX, sum the cells, compare to expected. ' +
        'Use this to self-check a build before closing the change set.',
        {
            tags: z.array(z.string()).optional().describe('Run only assertions with one of these tags'),
        },
        async ({ tags }) => {
            const { source, assertions: set } = await assertions.list(SERVER)
            if (!set.length) return ok(`No assertions stored for "${SERVER}" (source: ${source}). Add them with add_assertion.`)
            return ok(await runAssertions(tags))
        }
    )
}

module.exports = { register }
