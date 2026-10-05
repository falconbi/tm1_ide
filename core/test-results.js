'use strict'

// ── }TestResults — assertion run history (phase 2) ───────────────────────────
// A control cube records every assertion run: assertion × run × field
// (Pass / Actual / Expected), so failures show "newly vs always failing" and
// control checks trend on PROD. Recording is best-effort — a }TestResults
// problem never breaks an assertion run.

const CUBE = '}TestResults'
const DIM_ASSERTION = '}TestResults_Assertion'
const DIM_RUN       = '}TestResults_Run'
const DIM_FIELD     = '}TestResults_Field'
const FIELDS = ['Pass', 'Actual', 'Expected']

async function ensureCube(client) {
    const existing = await client.getCube(CUBE) // null when missing — must not return early on null
    if (existing) return
    for (const d of [DIM_ASSERTION, DIM_RUN, DIM_FIELD]) {
        try { await client.createDimension(d) } catch { /* exists */ }
    }
    try { await client.createCube(CUBE, [DIM_ASSERTION, DIM_RUN, DIM_FIELD]) } catch { /* exists */ }
    try { await client.bulkSetElements(DIM_FIELD, FIELDS.map(f => ({ name: f, type: 'N' }))) } catch { /* exists */ }
}

// Record a run on the given client's server. `runResult` is what assertions.run
// returns ({ results: [...] }). Best-effort — swallows failures so history can
// never break a run. Returns the run id (timestamp) used, or null.
async function recordRun(client, runResult, { runId } = {}) {
    try {
        await ensureCube(client)
        const runName = runId ?? new Date().toISOString().replace(/[-:.T]/g, '').slice(0, 14) // YYYYMMDDHHMMSS
        const ids = (runResult.results ?? []).map(r => r.id)
        await client.bulkSetElements(DIM_ASSERTION, ids.map(id => ({ name: id, type: 'N' }))).catch(() => {})
        await client.bulkSetElements(DIM_RUN, [{ name: runName, type: 'N' }]).catch(() => {})
        const updates = []
        for (const r of runResult.results ?? []) {
            const pair = (field, value) => ({ dimElemPairs: [
                { dim: DIM_ASSERTION, element: r.id },
                { dim: DIM_RUN,       element: runName },
                { dim: DIM_FIELD,     element: field },
            ], value })
            updates.push(pair('Pass', r.pass ? 1 : 0))
            updates.push(pair('Actual', r.error == null ? (r.actual ?? 0) : 0))
            updates.push(pair('Expected', r.expected ?? 0))
        }
        if (updates.length) await client.updateCells(CUBE, updates).catch(() => {})
        return runName
    } catch { return null }
}

// Read the last runs for one assertion (or the latest run for all when no id).
// Returns [{ run, pass, actual, expected }] newest-first.
async function recentRuns(client, { assertionId, limit = 10 } = {}) {
    try {
        const where = assertionId ? ` WHERE ([${DIM_ASSERTION}].[${assertionId}])` : ''
        const mdx = `SELECT {[${DIM_FIELD}].[Pass],[${DIM_FIELD}].[Actual],[${DIM_FIELD}].[Expected]} ON 0, {[${DIM_RUN}].Members} ON 1 FROM [${CUBE}]${where}`
        const r = await client.executeMDX(mdx, 5000)
        const cols = (r.Axes?.[0]?.Tuples ?? []).map(t => t.Members?.[0]?.Name)
        const rows = (r.Axes?.[1]?.Tuples ?? []).map(t => t.Members?.[0]?.Name)
        const nCols = cols.length
        const byRun = new Map()
        for (const c of r.Cells ?? []) {
            const run = rows[Math.floor(c.Ordinal / nCols)]
            const field = cols[c.Ordinal % nCols]
            if (!byRun.has(run)) byRun.set(run, { run })
            byRun.get(run)[field.toLowerCase()] = c.Value
        }
        return [...byRun.values()]
            .sort((a, b) => (a.run > b.run ? -1 : 1))
            .slice(0, limit)
    } catch { return [] }
}

module.exports = { recordRun, recentRuns, CUBE }