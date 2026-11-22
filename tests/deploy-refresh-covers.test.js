'use strict'

// Views and subsets are the last two object types a deploy ships, and TM1 Git's pull
// applies neither — so they are applied over REST. A refresh must move the target's
// version the other way with the same fidelity:
//   * an axis filter is copied exactly (a TM1FILTERBYPATTERN must never come back as
//     "all members"), and an axis that cannot be read blocks the copy;
//   * a view/subset on BOTH sides with different content is a conflict needing a
//     choice, and there is no default — the same rule as a delete or a move;
//   * a write that fails is an ERROR with TM1's message, never a "skip".

const { test } = require('node:test')
const assert = require('node:assert/strict')
const path = require('path')

const resolve = (rel) => require.resolve(path.join(__dirname, '..', rel))
const stub = (rel, exportsObj) => {
    const r = resolve(rel)
    require.cache[r] = { id: r, filename: r, loaded: true, exports: exportsObj }
}
// The module under test builds its own clients; route them by server name.
const clients = {}
const withClients = () => {
    stub('core/adapter-registry', { makeClient: (server) => ({ server }) })
    stub('core/tm1-client', {
        TM1Client: class { constructor(server) { return clients[server] } },
    })
    delete require.cache[resolve('core/refresh-covers')]
    return require('../core/refresh-covers')
}

// ── Fakes ───────────────────────────────────────────────────────────────────

function subsetServer({ subsets = {}, views = {}, cubes = {}, dims = {} }) {
    const calls = []
    return {
        calls,
        getModelDimensions: async () => Object.keys(dims).map(Name => ({ Name })),
        getModelCubes: async () => Object.keys(cubes).map(Name => ({ Name })),
        get: async (p) => {
            let m
            if ((m = p.match(/^Dimensions\('([^']+)'\)\/Hierarchies$/))) return { value: dims[m[1]].hierarchies.map(Name => ({ Name })) }
            if ((m = p.match(/^Dimensions\('([^']+)'\)\/Hierarchies\('([^']+)'\)\/Subsets$/))) {
                return { value: (dims[m[1]].subsets?.[m[2]] ?? []).map(Name => ({ Name })) }
            }
            if ((m = p.match(/^Cubes\('([^']+)'\)\/Views\('([^']+)'\)\/(Rows|Columns|Titles)/))) {
                const placements = views[m[1]]?.[m[2]]?.[m[3].toLowerCase()] ?? []
                return { value: placements.map(a => ({ Subset: a.subset ? { Name: a.subset, Expression: '' } : { Name: '', Expression: a.expression ?? null } })) }
            }
            throw new Error(`unexpected GET ${p}`)
        },
        getCube: async (cube) => ({ Dimensions: (cubes[cube] ?? []).map(Name => ({ Name })) }),
        getViews: async (cube) => Object.keys(views[cube] ?? {}).map(name => ({ name, type: views[cube][name].mdx ? 'mdx' : 'native' })),
        getView: async (cube, name) => {
            const v = views[cube]?.[name]
            if (!v) return null
            return v.mdx
                ? { '@odata.type': '#ibm.tm1.api.v1.MDXView', Name: name, MDX: v.mdx }
                : { '@odata.type': '#ibm.tm1.api.v1.NativeView', Name: name, SuppressEmptyRows: !!v.suppress, FormatString: v.format ?? null }
        },
        getSubset: async (dim, name, hier = dim) => {
            const s = dims[dim]?.subsets?.[hier]?.includes(name) ? (dims[dim].content?.[name] ?? {}) : null
            if (!s) return null
            return { Name: name, Expression: s.expression ?? '' }
        },
        getSubsetElements: async (dim, name) => (dims[dim]?.content?.[name]?.members ?? []).map(n => ({ name: n })),
        _extractMembersFromExpression: (expr) => {
            const names = [...String(expr ?? '').matchAll(/\.\[([^\]]+)\]/g)].map(m => m[1])
            return names.length ? [names[names.length - 1]] : []
        },
        saveSubset: async (dim, name, mdx, hier) => { calls.push(['saveSubset', dim, name, mdx, hier]) },
        saveStaticSubset: async (dim, name, els, hier) => { calls.push(['saveStaticSubset', dim, name, els, hier]) },
        saveView: async (cube, name, mdx) => { calls.push(['saveView', cube, name, mdx]) },
        saveNativeView: async (cube, name, spec) => { calls.push(['saveNativeView', cube, name, spec]) },
    }
}

const prodData = () => ({
    dims: {
        D: {
            hierarchies: ['D'],
            subsets: { D: ['S', 'S2'] },
            content: { S: { expression: 'HEAD({[D].[D].Members}, 3)' }, S2: { members: ['A', 'B'] } },
        },
    },
})

// ── Reading and comparing ───────────────────────────────────────────────────

test('an MDX subset compares by meaning, not by TM1\'s line wrapping', async () => {
    const { diffSubsetSpec } = withClients()
    const a = { mode: 'mdx', expression: 'HEAD(\n {[D].[D].Members},3)' }
    const b = { mode: 'mdx', expression: 'HEAD( {[D].[D].Members},3)' }
    const { normMdx } = withClients()
    assert.equal(diffSubsetSpec({ ...a, expression: normMdx(a.expression) }, { ...b, expression: normMdx(b.expression) }).differs, false)
})

test('a subset only the target has is a gap, not a conflict', () => {
    const { diffSubsetSpec } = withClients()
    const d = diffSubsetSpec({ mode: 'static', members: ['A'] }, null)
    assert.equal(d.adding, true)
})

test('a static subset with different members differs', () => {
    const { diffSubsetSpec } = withClients()
    assert.equal(diffSubsetSpec({ mode: 'static', members: ['A', 'B'] }, { mode: 'static', members: ['A'] }).parts.length, 1)
})

test('two native views differ when an axis expression differs', () => {
    const { diffViewSpec } = withClients()
    const base = {
        mode: 'native',
        rows: [{ dimension: 'D', subset: null, expression: '{[D].[D].[A]}', members: ['A'] }],
        columns: [], titles: [], suppressEmptyRows: false, suppressEmptyColumns: false, formatString: null,
    }
    assert.equal(diffViewSpec(base, base).differs, false)
    const other = { ...base, rows: [{ dimension: 'D', subset: null, expression: '{[D].[D].[B]}', members: ['B'] }] }
    assert.deepEqual(diffViewSpec(other, base).parts, ['rows'])
})

test('an axis with no subset and no expression is unreadable — never copied as "all"', () => {
    const { unreadableAxes } = withClients()
    assert.deepEqual(unreadableAxes({ rows: [{ dimension: 'D', subset: null, expression: null }], columns: [], titles: [] }), ['rows (D)'])
})

// ── Planning ────────────────────────────────────────────────────────────────

test('plan: an object only on the target is brought across; one on both is a choice with no default', async () => {
    const { planCovers } = withClients()
    const prod = subsetServer(prodData())
    const dev = subsetServer({
        dims: { D: { hierarchies: ['D'], subsets: { D: ['S2', 'S3'] }, content: { S2: { members: ['A'] }, S3: { expression: '{[D].[D].[C]}' } } } },
    })
    clients.DEV = dev
    clients.PROD = prod
    const p = await planCovers('DEV', 'PROD')
    const S = p.subsets.find(x => x.name === 'S')
    const S2 = p.subsets.find(x => x.name === 'S2')
    assert.equal(S.adding, true)
    assert.equal(S.choice, 'take')          // a gap arrives by default
    assert.equal(S2.adding, false)
    assert.equal(S2.choice, null)           // a conflict has no default
    assert.ok(!p.subsets.some(x => x.name === 'S3'))   // only on DEV: the deploy carries it, no refresh
})

test('plan: a hierarchy DEV lacks is reported, not created', async () => {
    const { planCovers } = withClients()
    const prod = subsetServer({
        dims: { D: { hierarchies: ['D', 'Alt'], subsets: { D: [], Alt: ['X'] }, content: { X: { members: ['A'] } } } },
    })
    const dev = subsetServer({ dims: { D: { hierarchies: ['D'], subsets: { D: [] }, content: {} } } })
    clients.DEV = dev
    clients.PROD = prod
    const p = await planCovers('DEV', 'PROD')
    assert.equal(p.skipped.length, 1)
    assert.match(p.skipped[0].why, /alternate-hierarchy/)
})

// ── Applying ────────────────────────────────────────────────────────────────

test('a title bound to a named subset is refused: its selection cannot be read', async () => {
    // The API omits Selected for a named-subset title, so a copy would write the
    // dimension's default member — changing the target's selection, not copying it.
    const { applyCovers } = withClients()
    const prod = subsetServer({
        cubes: { C: ['D'] },
        views: { C: { V: { rows: [{ dimension: 'D', expression: '{[D].[D].[A]}' }], columns: [], titles: [{ dimension: 'D', subset: 'S' }] } } },
        dims: { D: { hierarchies: ['D'], subsets: { D: ['S'] }, content: { S: { members: ['A'] } } } },
    })
    const dev = subsetServer({ cubes: { C: ['D'] }, views: { C: {} }, dims: { D: { hierarchies: ['D'], subsets: { D: [] }, content: {} } } })
    const r = await applyCovers(dev, prod, {
        source: 'DEV', target: 'PROD', log: () => {},
        covers: [{ type: 'view', name: 'V', cube: 'C', choice: 'take' }],
    })
    assert.deepEqual(dev.calls, [])
    assert.match(r.errors[0].why, /title selection \(named subset S\)/)
})

test('taking an MDX subset writes the target\'s expression to DEV', async () => {
    const { applyCovers } = withClients()
    const prod = subsetServer(prodData())
    const dev = subsetServer({ dims: { D: { hierarchies: ['D'], subsets: { D: ['S'] }, content: { S: { expression: 'OLD' } } } } })
    const r = await applyCovers(dev, prod, {
        source: 'DEV', target: 'PROD', log: () => {},
        covers: [{ type: 'subset', name: 'S', dimension: 'D', hierarchy: 'D', choice: 'take' }],
    })
    assert.deepEqual(r.errors, [])
    assert.deepEqual(dev.calls[0], ['saveSubset', 'D', 'S', 'HEAD({[D].[D].Members}, 3)', 'D'])
    assert.equal(r.changed[0].label, 'subset S (D)')
})

test('taking a static subset writes its members in order', async () => {
    const { applyCovers } = withClients()
    const prod = subsetServer(prodData())
    const dev = subsetServer({ dims: { D: { hierarchies: ['D'], subsets: { D: ['S2'] }, content: {} } } })
    const r = await applyCovers(dev, prod, {
        source: 'DEV', target: 'PROD', log: () => {},
        covers: [{ type: 'subset', name: 'S2', dimension: 'D', hierarchy: 'D', choice: 'take' }],
    })
    assert.deepEqual(dev.calls[0], ['saveStaticSubset', 'D', 'S2', ['A', 'B'], 'D'])
    assert.equal(r.errors.length, 0)
})

test('keeping DEV\'s version writes nothing and records the decision', async () => {
    const { applyCovers } = withClients()
    const prod = subsetServer(prodData())
    const dev = subsetServer({ dims: { D: { hierarchies: ['D'], subsets: { D: ['S'] }, content: {} } } })
    const logged = []
    const r = await applyCovers(dev, prod, {
        source: 'DEV', target: 'PROD', log: (e) => logged.push(e),
        covers: [{ type: 'subset', name: 'S', dimension: 'D', hierarchy: 'D', choice: 'keep' }],
    })
    assert.deepEqual(dev.calls, [])
    assert.equal(logged[0].action, 'REFRESH_DECISION')
    assert.equal(logged[0].objectType, 'decision')   // never counted as an object change
    assert.match(logged[0].detail, /next deploy carries it/)
    assert.equal(r.decisions.length, 1)
})

test('taking a native view copies its filter verbatim and its title member', async () => {
    const { applyCovers } = withClients()
    const prod = subsetServer({
        cubes: { C: ['D'] },
        views: {
            C: {
                V: {
                    rows: [{ dimension: 'D', expression: 'TM1FILTERBYPATTERN({[D].[D].Members}, "A*")' }],
                    columns: [{ dimension: 'D', expression: '{[D].[D].[A]}' }],
                    titles: [{ dimension: 'D', expression: '{[D].[D].[B]}' }],
                    suppress: true, format: '#,##0',
                },
            },
        },
    })
    const dev = subsetServer({ cubes: { C: ['D'] }, views: { C: {} } })
    const r = await applyCovers(dev, prod, {
        source: 'DEV', target: 'PROD', log: () => {},
        covers: [{ type: 'view', name: 'V', cube: 'C', choice: 'take' }],
    })
    assert.deepEqual(r.errors, [])
    const [, , , spec] = dev.calls.find(c => c[0] === 'saveNativeView')
    assert.equal(spec.rows[0].customExpr, 'TM1FILTERBYPATTERN({[D].[D].Members}, "A*")')
    assert.equal(spec.titles[0].member, 'B')          // the selection, not the default member
    assert.equal(spec.suppressEmptyRows, true)
    assert.equal(spec.formatString, '#,##0')
})

test('an unreadable axis on the target is refused with a reason, and nothing is written', async () => {
    const { applyCovers } = withClients()
    const prod = subsetServer({
        cubes: { C: ['D'] },
        views: { C: { V: { rows: [{ dimension: 'D', expression: null }], columns: [], titles: [] } } },
    })
    const dev = subsetServer({ cubes: { C: ['D'] }, views: { C: {} } })
    const r = await applyCovers(dev, prod, {
        source: 'DEV', target: 'PROD', log: () => {},
        covers: [{ type: 'view', name: 'V', cube: 'C', choice: 'take' }],
    })
    assert.deepEqual(dev.calls, [])
    assert.equal(r.errors.length, 1)
    assert.match(r.errors[0].why, /nothing written/)
})

test('a write TM1 refuses is an ERROR with its message — never a skip', async () => {
    const { applyCovers } = withClients()
    const prod = subsetServer(prodData())
    const dev = subsetServer({ dims: { D: { hierarchies: ['D'], subsets: { D: ['S'] }, content: {} } } })
    dev.saveSubset = async () => { throw new Error('subset S is used by view V') }
    const r = await applyCovers(dev, prod, {
        source: 'DEV', target: 'PROD', log: () => {},
        covers: [{ type: 'subset', name: 'S', dimension: 'D', hierarchy: 'D', choice: 'take' }],
    })
    assert.equal(r.changed.length, 0)
    assert.equal(r.errors.length, 1)
    assert.match(r.errors[0].why, /used by view V/)
})

test('a conflict with no choice is an error, not a silent omission', async () => {
    const { applyCovers } = withClients()
    const prod = subsetServer(prodData())
    const dev = subsetServer({ dims: { D: { hierarchies: ['D'], subsets: { D: ['S'] }, content: {} } } })
    const r = await applyCovers(dev, prod, {
        source: 'DEV', target: 'PROD', log: () => {},
        covers: [{ type: 'subset', name: 'S', dimension: 'D', hierarchy: 'D', choice: null }],
    })
    assert.deepEqual(dev.calls, [])
    assert.match(r.errors[0].why, /no choice made/)
})

test('subsets are applied before views, whatever order they arrive in', async () => {
    const { applyCovers } = withClients()
    const prod = subsetServer({
        ...prodData(),
        cubes: { C: ['D'] },
        views: { C: { V: { rows: [{ dimension: 'D', subset: 'S' }], columns: [], titles: [] } } },
    })
    const dev = subsetServer({ dims: { D: { hierarchies: ['D'], subsets: { D: ['S'] }, content: {} } }, cubes: { C: ['D'] }, views: { C: {} } })
    await applyCovers(dev, prod, {
        source: 'DEV', target: 'PROD', log: () => {},
        covers: [
            { type: 'view', name: 'V', cube: 'C', choice: 'take' },
            { type: 'subset', name: 'S', dimension: 'D', hierarchy: 'D', choice: 'take' },
        ],
    })
    assert.deepEqual(dev.calls.map(c => c[0]), ['saveSubset', 'saveNativeView'])
})

// ── The guard, at the level the route calls ─────────────────────────────────

test('applyRefresh refuses a conflicting view/subset before writing anything', async () => {
    const prod = subsetServer(prodData())
    const dev = subsetServer({ dims: { D: { hierarchies: ['D'], subsets: { D: ['S'] }, content: { S: { expression: 'DEV VERSION' } } } } })
    clients.DEV = dev
    clients.PROD = prod
    withClients()
    stub('core/change-log', {
        getSession: () => ({ id: 's1', server: 'DEV', closed_at: null }),
        writeLog: () => ({ hasSession: true }),
    })
    stub('core/deploy-settings', { get: async () => ({}) })
    delete require.cache[resolve('core/refresh-dev')]
    const { applyRefresh } = require('../core/refresh-dev')

    await assert.rejects(
        applyRefresh('DEV', 'PROD', { session: 's1', accept: [], chores: [], covers: [] }),
        (e) => {
            assert.equal(e.refused, true)
            assert.match(e.message, /subset S \(D\)/)
            assert.match(e.message, /take the target's/)
            return true
        }
    )
    assert.deepEqual(dev.calls, [])
})
