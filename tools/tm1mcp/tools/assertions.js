'use strict'

const { z } = require('zod')

// ══════════════════════════════════════════════════════════════════════════════
// ASSERTIONS
// ══════════════════════════════════════════════════════════════════════════════

function register(server, { client, assertions, runAssertions, ok, SERVER }) {
    server.tool(
        'add_assertion',
        'Record an expected result for this model — an MDX query and the number it should return. ' +
        'The assertion is stored (config/assertions.json) and run on every close_change_set, plus on demand via run_assertions. ' +
        'It is executed once immediately so you know the query and expected value are right.',
        {
            description: z.string().describe('What this checks, in words — e.g. "IT pool clears: total DR = pool"'),
            mdx:         z.string().describe('MDX SELECT. Returned cells are summed and compared to `expected`.'),
            expected:    z.number().describe('The value the summed cells should equal'),
            tolerance:   z.number().optional().describe('Absolute tolerance (default 0.01)'),
            tags:        z.array(z.string()).optional().describe('Labels for running a subset later'),
        },
        async ({ description, mdx, expected, tolerance, tags }) => {
            const rec = assertions.add(SERVER, { description, mdx, expected, tolerance, tags })
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
        'List the stored assertions for this server',
        {},
        async () => ok(assertions.list(SERVER))
    )

    server.tool(
        'remove_assertion',
        'Delete a stored assertion by id',
        { id: z.string().describe('Assertion id (from add_assertion or list_assertions)') },
        async ({ id }) => ok(assertions.remove(SERVER, id) ? `Removed assertion ${id}.` : `No assertion ${id} for "${SERVER}".`)
    )

    server.tool(
        'run_assertions',
        'Run the stored assertions now — execute each MDX, sum the cells, compare to expected. ' +
        'Use this to self-check a build before closing the change set.',
        {
            tags: z.array(z.string()).optional().describe('Run only assertions with one of these tags'),
        },
        async ({ tags }) => {
            const set = assertions.list(SERVER)
            if (!set.length) return ok(`No assertions stored for "${SERVER}". Add them with add_assertion.`)
            return ok(await runAssertions(tags))
        }
    )
}

module.exports = { register }
