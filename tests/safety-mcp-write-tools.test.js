'use strict'
// A light run of every write tool, end to end through the real MCP wiring, against
// a fake TM1 and fake deploy / Lens / assertion stores. It doesn't check TM1
// behaviour — it checks each tool can run at all: every helper it uses is wired
// in, every argument reaches it, and its change lands on the change set. The
// "esc is not defined" bug (Sep 12 → Oct 15) broke four of these tools for a
// month because no test ever called them.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const path = require('path')

// ── Fakes for modules the tools require at call time (deploy tooling) ─────────
const stub = (rel, exports) => {
    const f = require.resolve(path.join('..', rel))
    require.cache[f] = { id: f, filename: f, loaded: true, exports }
}
const calls = []
stub('tools/tm1deploy/src/snapshot', { async seed(server, _a, _b, meta) { calls.push(['seed', server]); return { _meta: { seeded_at: 'now', last_entry_id: meta.last_entry_id, counts: {} } } } })
stub('tools/tm1deploy/src/diff', {
    listBaselines: () => [], setBaselineHead: (s, file) => { calls.push(['head', file]); return { head: file, _meta: {} } },
    loadBaseline: () => null, async diff() { return {} },
})
stub('tools/tm1deploy/src/packager', { async pack(server, entries, name) { calls.push(['pack', name, entries.length]); return { packaged: entries.length, skipped: 0, outputDir: 'packages/x', manifest: { objects: [] } } } })

// Lens store / bridge / Viewfinder: the Lens tools hold these modules, so swap the functions.
const lensStore = require('../core/lens_store')
lensStore.saveLens = async (server, name) => { calls.push(['saveLens', name]); return { name, version: 1 } }
lensStore.deleteLens = async (server, name) => { calls.push(['deleteLens', name]) }
require('../core/lens_bridge').validateLens = async () => []

const { setup } = require('./_mcp-harness')

// A TM1 that says yes to everything: any method resolves; list-ish getters give
// empty lists, getCube knows its dimensions.
function yesTm1() {
    const t = { who: 'builder', calls: [] }
    return new Proxy(t, {
        get(target, prop) {
            if (prop in target) return target[prop]
            if (prop === 'then') return undefined
            return async (...args) => {
                target.calls.push([prop, ...args])
                if (prop === 'getCube') return { Name: args[0], Dimensions: [{ Name: 'Region' }, { Name: 'Month' }] }
                if (prop === 'getProcess' || prop === 'getChore') throw Object.assign(new Error('not found'), { response: { status: 404 } })
                if (/^get.*s$|^list/.test(prop)) return []
                if (prop === 'executeProcess') return { ProcessExecuteStatusCode: 'CompletedSuccessfully' }
                return { value: [] }
            }
        },
    })
}

function fakeCl() {
    const session = { id: 'cs-1', name: 'AI: test', started_at: 'now' }
    let open = false
    return {
        getActiveSession: () => (open ? session : null),
        startSession: () => { open = true; return session },
        closeSession: () => { open = false },
        getSessionLog: () => [{ object_type: 'cube', object_name: 'Sales', action: 'CUBE_CREATED' }],
        getCrossSessionTouches: () => [],
        getEntriesSinceId: () => [], getEntriesSince: () => [], getMaxEntryId: () => 7,
        writeLog: () => ({}),
    }
}
const fakeAssertions = {
    async list() { return { source: 'model', assertions: [] } },
    async add(server, a) { calls.push(['addAssertion']); return { id: 'a1', ...a } },
    async remove() { calls.push(['removeAssertion']); return true },
}

// Minimal valid arguments for every write tool.
const ARGS = {
    add_assertion:         { description: 'Sales total', mdx: 'SELECT {} ON 0 FROM [Sales]', expected: 0 },
    remove_assertion:      { id: 'a1' },
    build_dimension:       { name: 'Region', elements: [{ name: 'North' }, { name: 'Total', type: 'C' }], edges: [{ parent: 'Total', child: 'North' }], attributes: [{ name: 'Code' }], attribute_values: [{ element: 'North', attribute: 'Code', value: 'N' }] },
    add_elements:          { dimension: 'Region', elements: [{ name: 'South' }], edges: [{ parent: 'Total', child: 'South' }] },
    create_hierarchy:      { dimension: 'Region', name: 'By Manager' },
    restructure_dimension: { dimension: 'Region', set_weights: [{ parent: 'Total', child: 'North', weight: 1 }] },
    set_attribute_values:  { dimension: 'Region', values: [{ element: 'North', attribute: 'Code', value: 'N' }] },
    build_cube:            { name: 'Sales', dimensions: ['Region', 'Month'], rules: "['Total'] = N: 1;" },
    reprocess_feeders:     { cubes: ['Sales'] },
    build_process:         { name: 'Load Sales', prolog: "vCube = 'Sales';" },
    write_cells:           { cube: 'Sales', cells: [{ coordinates: { Region: 'North', Month: 'Jan' }, value: 1 }] },
    create_view:           { cube: 'Sales', name: 'Default', mdx: 'SELECT {} ON 0 FROM [Sales]' },
    create_subset:         { dimension: 'Region', subset: 'Leaves', expression: '{TM1FILTERBYLEVEL({TM1SUBSETALL([Region])},0)}' },
    create_chore:          { name: 'Nightly', steps: [{ process: 'Load Sales' }] },
    set_chore_state:       { name: 'Nightly', activate: true },
    delete_object:         { type: 'chore', name: 'Nightly' },
    seed_baseline:         { label: 'test' },
    set_baseline_head:     { file: '2026-10-15T00-00-00-000Z.json' },
    start_change_set:      { name: 'AI: test' },
    close_change_set:      {},
    package_change_set:    {},
    update_cube_rules:     { cube: 'Sales', rules: "['Total'] = N: 1;" },
    update_process:        { process: 'Load Sales', prolog: "vCube = 'Sales';" },
    run_process:           { process: 'Load Sales' },
    save_lens:             { name: 'sales-lens', html: '<html><body>Sales</body></html>', config: {} },
    delete_lens:           { name: 'sales-lens' },
}

// Errors that mean the tool's own wiring is broken, never a TM1 answer.
const WIRING = /is not defined|is not a function|Cannot read properties of (undefined|null)|is not iterable|Cannot destructure/

test('every write tool has a light test here', () => {
    const guard = require('../tools/tm1mcp/guard')
    assert.deepEqual(Object.keys(ARGS).sort(), [...guard.WRITE_TOOLS].sort())
})

for (const tool of Object.keys(ARGS)) {
    test(`write tool runs: ${tool}`, async () => {
        const h = setup({ mode: 'build', builder: yesTm1(), cl: fakeCl(), assertions: fakeAssertions })
        // Tools that need an open change set get one first (start_change_set itself, and those that report on it).
        if (['close_change_set', 'package_change_set'].includes(tool)) await h.call('start_change_set', { name: 'AI: test' })
        const r = await h.call(tool, ARGS[tool])
        assert.doesNotMatch(r.text, WIRING, `${tool} is mis-wired: ${r.text}`)
        assert.equal(r.isError, false, `${tool} failed: ${r.text}`)
    })
}
