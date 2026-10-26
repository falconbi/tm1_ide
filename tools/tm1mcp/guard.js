'use strict'

// ── MCP read security — the pure rules ───────────────────────────────────────
// No TM1, no server binding, no I/O except loading the policy file — so every
// rule here is unit-tested directly (tests/safety-mcp-*.test.js).
//
//   classify(tool)          — every tool is READ or WRITE; an unclassified tool
//                             stops the MCP at start-up (a new tool can't slip in
//                             unreviewed, and readonly mode can't miss a writer)
//   loadPolicy(server)      — which cubes / dimensions / processes an agent may
//                             read, and what gets masked (config/mcp-security.json)
//   allowed(policy, kind, name)
//   cubesInMdx(mdx)         — the cubes an MDX query reads (FROM [...])
//   redactCells / redactAttributes — mask, round or block per cube / attribute
//   stripTiCredentials      — always on: passwords never leave in TI code

const fs   = require('fs')
const path = require('path')

// ── Tool classification ──────────────────────────────────────────────────────

const READ_TOOLS = new Set([
    // model context
    'read_build_guide', 'list_cubes', 'get_cube_rules', 'get_cube_dimensions', 'list_dimensions',
    'get_elements', 'get_element_attributes', 'list_processes', 'get_process', 'list_views', 'get_view',
    'list_subsets', 'get_subset', 'list_chores', 'get_chore', 'find_cubes_using_dimension',
    // data
    'read_cells', 'execute_view',
    // checks and diagnostics
    'check_rules_syntax', 'check_feeders', 'trace_feeders', 'get_process_log', 'get_active_threads',
    'get_transaction_log', 'list_error_logs', 'find_dimension_usage', 'find_cube_usage',
    'find_process_usage', 'search_ti_code',
    // governance (read side)
    'list_assertions', 'run_assertions', 'list_baselines', 'get_change_set', 'diff_change_set',
    'check_deploy_risk', 'check_target_drift',
    // Lenses (read side)
    'list_lens_examples', 'list_lenses', 'get_lens',
])

const WRITE_TOOLS = new Set([
    'add_assertion', 'remove_assertion',
    'build_dimension', 'add_elements', 'create_hierarchy', 'restructure_dimension', 'set_attribute_values',
    'build_cube', 'reprocess_feeders', 'build_process', 'build_period_dimension', 'write_cells', 'create_view', 'create_subset',
    'create_chore', 'set_chore_state', 'delete_object',
    'seed_baseline', 'set_baseline_head', 'start_change_set', 'close_change_set', 'package_change_set',
    'update_cube_rules', 'update_process', 'run_process', 'copy_version', 'save_data_all',
    'save_lens', 'delete_lens',
])

function classify(tool) {
    if (READ_TOOLS.has(tool))  return 'read'
    if (WRITE_TOOLS.has(tool)) return 'write'
    throw new Error(`tm1mcp: tool "${tool}" is not classified as read or write in tools/tm1mcp/guard.js — add it to READ_TOOLS or WRITE_TOOLS before it can be served`)
}

// readonly | build. Unset → readonly, on every server: an AI connected to TM1 can
// only read until someone deliberately asks for build mode (MCP_MODE=build).
// Asking for build on a read-only server is refused outright rather than quietly
// downgraded — the operator should know.
function resolveMode(requested, serverIsReadOnly) {
    const m = (requested ?? '').trim().toLowerCase()
    if (m && m !== 'readonly' && m !== 'build') throw new Error(`MCP_MODE must be "readonly" or "build" (got "${requested}")`)
    if (m === 'build' && serverIsReadOnly) throw new Error('MCP_MODE=build was asked for, but this server is read-only (PROD posture) — leave MCP_MODE unset (read-only), or bind a writable server to build')
    return m || 'readonly'
}

// ── Policy ───────────────────────────────────────────────────────────────────
// config/mcp-security.json (optional; see config/mcp-security.example.json):
// {
//   "*":        { "cubes": { "deny": ["Payroll*"] }, "redact": { "cells": [...], "attributes": [...] } },
//   "MyServer": { "cubes": { "allow": ["Sales*", "Opex*"] } }
// }
// "*" applies to every server; a server's own entry adds to it (lists are joined;
// an allow list anywhere narrows to that list). Default with no file: all model
// cubes, dimensions and processes, minus the built-in sensitive set below.

// Security and identity objects TM1 keeps as control cubes / dimensions — never
// readable through the MCP, whatever the policy file says.
const BUILT_IN_DENY = {
    cubes:      ['}Client*', '}*Security*', '}Capabilities', '}Groups*'],
    dimensions: ['}Clients', '}Groups', '}Client*'],
    processes:  [],
}

const POLICY_FILE = path.join(__dirname, '..', '..', 'config', 'mcp-security.json')

function _list(v) { return Array.isArray(v) ? v.map(String) : [] }

function buildPolicy(raw, server) {
    const parts = [raw?.['*'], raw?.[server]].filter(Boolean)
    const pol = { server, cubes: {}, dimensions: {}, processes: {}, redact: { cells: [], attributes: [] } }
    for (const kind of ['cubes', 'dimensions', 'processes']) {
        const allow = parts.flatMap(p => _list(p[kind]?.allow))
        pol[kind] = {
            allow: allow.length ? allow : null,                                   // null = everything
            deny:  [...BUILT_IN_DENY[kind], ...parts.flatMap(p => _list(p[kind]?.deny))],
        }
    }
    for (const p of parts) {
        pol.redact.cells.push(...(Array.isArray(p.redact?.cells) ? p.redact.cells : []))
        pol.redact.attributes.push(...(Array.isArray(p.redact?.attributes) ? p.redact.attributes : []))
    }
    for (const r of pol.redact.cells) _checkAction(r.action, `cell redaction on "${r.cube}"`)
    for (const r of pol.redact.attributes) _checkAction(r.action, `attribute redaction on "${r.dimension}"/"${r.attribute}"`)
    return pol
}

// A broken policy file stops the MCP: guessing "no restrictions" on a typo is
// exactly the silent failure this exists to prevent.
function loadPolicy(server, file = POLICY_FILE) {
    if (!fs.existsSync(file)) return buildPolicy({}, server)
    let raw
    try { raw = JSON.parse(fs.readFileSync(file, 'utf8')) }
    catch (e) { throw new Error(`${path.basename(file)} is not valid JSON (${e.message}) — fix it; the MCP will not start on a policy it cannot read`) }
    return buildPolicy(raw, server)
}

// Wildcards: * = any run of characters. Case-insensitive, like TM1 names.
function _rx(pattern) {
    // \* in a pattern is a literal asterisk; a bare * is the wildcard.
    const parts = String(pattern).split('\\*').map(p => p.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*'))
    return new RegExp('^' + parts.join('\\*') + '$', 'i')
}
function matches(pattern, name) { return _rx(pattern).test(String(name ?? '')) }
function matchesAny(patterns, name) { return (patterns ?? []).some(p => matches(p, name)) }

function allowed(policy, kind, name) {
    const rule = policy?.[kind]
    if (!rule || name == null) return true
    if (matchesAny(rule.deny, name)) return false
    return !rule.allow || matchesAny(rule.allow, name)
}

function refusal(kind, name) {
    const what = { cubes: 'cube', dimensions: 'dimension', processes: 'process' }[kind] ?? kind
    return `Access to ${what} "${name}" is not allowed through the MCP (config/mcp-security.json or the built-in sensitive list)`
}

// Throws when any object a tool call names is outside the policy.
function checkArgs(policy, args = {}) {
    const checks = [
        ['cubes', args.cube], ['dimensions', args.dimension], ['processes', args.process],
        ...(Array.isArray(args.cubes) ? args.cubes.map(c => ['cubes', c]) : []),
        ...cubesInMdx(args.mdx).map(c => ['cubes', c]),
    ]
    for (const [kind, name] of checks) {
        if (name != null && !allowed(policy, kind, name)) throw new Error(refusal(kind, name))
    }
}

// The cubes an MDX query reads: FROM [Cube] (and FROM Cube), including subselects.
function cubesInMdx(mdx) {
    if (!mdx || typeof mdx !== 'string') return []
    const out = new Set()
    const re = /\bFROM\s+(?:\[((?:[^\]]|\]\])+)\]|([A-Za-z_}][\w}]*))/gi
    let m
    while ((m = re.exec(mdx))) out.add((m[1] ?? m[2]).replace(/\]\]/g, ']'))
    return [...out]
}

// Every [x].[y].[z] member reference in an MDX WHERE clause — the slicer
// members a cell is read at, which never show on the result's axes.
function whereMembers(mdx) {
    if (!mdx) return []
    const i = mdx.search(/\bWHERE\b/i)
    if (i < 0) return []
    return [...mdx.slice(i).matchAll(/\[((?:[^\]]|\]\])+)\]/g)].map(m => m[1].replace(/\]\]/g, ']'))
}

// ── Redaction ────────────────────────────────────────────────────────────────
// Cell rules:      { "cube": "Payroll*", "members": ["Salary*"], "action": "mask" | "round:-3" | "block" }
//                  members omitted = every cell of the cube. A cell matches when
//                  any of its members (rows, columns or WHERE) matches a pattern.
// Attribute rules: { "dimension": "Employee", "attribute": "Salary*", "action": "mask" | "block" }

function _checkAction(action, where) {
    if (action === 'mask' || action === 'block' || /^round:-?\d+$/.test(String(action))) return
    throw new Error(`mcp-security.json: ${where} has action "${action}" — use "mask", "block" or "round:N" (e.g. round:-3 = nearest thousand)`)
}

const MASK = '***'

function _apply(action, cell) {
    if (action === 'mask') return { ...cell, value: null, formatted: MASK, redacted: 'mask' }
    const n = Number(String(action).split(':')[1])
    if (typeof cell.value !== 'number') return { ...cell, value: null, formatted: MASK, redacted: 'mask' }
    const value = n >= 0
        ? Math.round(cell.value * 10 ** n) / 10 ** n
        : Math.round(cell.value / 10 ** -n) * 10 ** -n
    return { ...cell, value, formatted: String(value), redacted: action }
}

// Members of each cell of a cellset: ordinal → [names]. TM1 numbers cells
// column-major across axes: ordinal = i0 + n0 * (i1 + n1 * i2 ...).
function cellMembers(axes, ordinal) {
    const out = []
    let rest = ordinal
    for (const ax of axes ?? []) {
        const tuples = ax?.Tuples ?? []
        const n = tuples.length || 1
        const t = tuples[rest % n]
        rest = Math.floor(rest / n)
        for (const m of t?.Members ?? []) out.push(m.Name)
    }
    return out.filter(Boolean)
}

// cells: [{ ordinal, value, formatted }] from read_cells / execute_view.
// Returns { cells, redacted: count } or throws on a "block" rule.
function redactCells(policy, { cube, axes, cells, mdx }) {
    const rules = (policy?.redact?.cells ?? []).filter(r => matches(r.cube, cube))
    if (!rules.length) return { cells, redacted: 0 }
    const sliced = whereMembers(mdx)
    let count = 0
    const out = cells.map(cell => {
        if (cell.redacted) return cell
        const members = [...cellMembers(axes, cell.ordinal), ...sliced]
        const hit = rules.find(r => !Array.isArray(r.members) || !r.members.length
            || members.some(m => matchesAny(r.members, m)))
        if (!hit) return cell
        if (hit.action === 'block') throw new Error(`Reading "${cube}" ${hit.members?.length ? `at ${hit.members.join(', ')} ` : ''}is blocked by config/mcp-security.json`)
        count++
        return _apply(hit.action, cell)
    })
    return { cells: out, redacted: count }
}

// A masked member must not be recoverable from a total: a parent minus its
// visible children gives the masked leaf back exactly. So before masking, every
// member-level rule on this cube is widened to all ANCESTORS of the elements it
// matches (in every dimension of the cube, default hierarchies). If a dimension's
// tree can't be read, the rule widens to the whole cube — fail closed.
// Masking is still cosmetic next to TM1 element / cell security on the reader
// login: a rule-calculated cell built from a masked value (e.g. Total Comp =
// Salary + Bonus as a leaf) is not a consolidation and is not caught here.
const _treeCache = new WeakMap()          // client → Map(dim → { at, parents })
const TREE_TTL_MS = 5 * 60 * 1000

async function _parentsOf(c, dim) {
    let byDim = _treeCache.get(c)
    if (!byDim) { byDim = new Map(); _treeCache.set(c, byDim) }
    const hit = byDim.get(dim)
    if (hit && Date.now() - hit.at < TREE_TTL_MS) return hit.parents
    const elems = await c.getElementsWithTree(dim)
    const hasTree = elems.some(e => Array.isArray(e.Components) && e.Components.length)
    const hasConsolidations = elems.some(e => e.Type === 'C')
    if (hasConsolidations && !hasTree) throw new Error(`no parent/child data for ${dim}`)
    const parents = new Map()
    for (const e of elems) for (const ch of e.Components ?? []) {
        const k = String(ch).toLowerCase()
        if (!parents.has(k)) parents.set(k, [])
        parents.get(k).push(e.Name)
    }
    const names = elems.map(e => e.Name)
    const entry = { at: Date.now(), parents, names }
    byDim.set(dim, entry)
    return entry
}

async function maskPolicyFor(policy, cube, c) {
    const rules = (policy?.redact?.cells ?? []).filter(r => matches(r.cube, cube) && Array.isArray(r.members) && r.members.length)
    if (!rules.length) return { policy, widened: 0 }
    let trees
    try {
        const dims = ((await c.getCube(cube))?.Dimensions ?? []).map(d => d.Name)
        trees = await Promise.all(dims.map(d => _parentsOf(c, d)))
    } catch {
        // Can't see the hierarchy → mask the whole cube for these rules.
        const cells = policy.redact.cells.map(r => rules.includes(r) ? { ...r, members: [] } : r)
        return { policy: { ...policy, redact: { ...policy.redact, cells } }, widened: -1 }
    }
    let widened = 0
    const cells = policy.redact.cells.map(r => {
        if (!rules.includes(r)) return r
        const extra = new Set()
        for (const t of trees) {
            const seeds = t.names.filter(n => matchesAny(r.members, n))
            const stack = seeds.map(n => n.toLowerCase())
            const seen = new Set(stack)
            while (stack.length) {
                for (const p of t.parents.get(stack.pop()) ?? []) {
                    const k = p.toLowerCase()
                    if (seen.has(k)) continue
                    seen.add(k); stack.push(k); extra.add(p)
                }
            }
        }
        widened += extra.size
        // Exact names: escape the * wildcard so a parent called "A*" matches only itself.
        return { ...r, members: [...r.members, ...[...extra].map(n => n.replace(/\*/g, '\\*'))] }
    })
    return { policy: { ...policy, redact: { ...policy.redact, cells } }, widened }
}

// values: { attrName: value } for one element of `dimension`.
function redactAttributes(policy, dimension, values) {
    const rules = (policy?.redact?.attributes ?? []).filter(r => matches(r.dimension, dimension))
    if (!rules.length || !values) return { values, redacted: 0 }
    const out = {}
    let count = 0
    for (const [k, v] of Object.entries(values)) {
        const hit = rules.find(r => matches(r.attribute, k))
        if (!hit) { out[k] = v; continue }
        if (hit.action === 'block') throw new Error(`Attribute "${k}" of "${dimension}" is blocked by config/mcp-security.json`)
        count++
        out[k] = hit.action === 'mask' || typeof v !== 'number' ? MASK : _apply(hit.action, { value: v }).value
    }
    return { values: out, redacted: count }
}

// ── TI credentials ───────────────────────────────────────────────────────────
// Always on, no setting: a password typed into TI code or a datasource never
// reaches the agent. Covers the places TM1 code actually carries one:
//   ODBCOpen / ODBCOpenEx(dsn, user, PASSWORD, ...)   AssignClientPassword(user, PASSWORD)
//   vPassword = '...';  sPwd = '...';  (any pass/pwd/secret/token/apikey variable)
//   PWD=...; / Password=...; inside a connection string
//   a datasource's password field

const SECRET_VAR = /^[\w$]*(?:pass(?:word)?|pwd|secret|token|api_?key)[\w$]*$/i
const SECRET_ARGS = { ODBCOPEN: 2, ODBCOPENEX: 2, ASSIGNCLIENTPASSWORD: 1 }

// Split the argument list starting just after '(' — respects 'quoted '' strings'
// and nested parentheses. Returns { args: [{start,end}], close } (offsets in code).
function _args(code, from) {
    const args = []
    let depth = 0, start = from, i = from
    for (; i < code.length; i++) {
        const ch = code[i]
        if (ch === "'") { i++; while (i < code.length && !(code[i] === "'" && code[i + 1] !== "'")) { if (code[i] === "'") i++; i++ } continue }
        if (ch === '(') depth++
        else if (ch === ')') { if (!depth) break; depth-- }
        else if (ch === ',' && !depth) { args.push({ start, end: i }); start = i + 1 }
    }
    args.push({ start, end: i })
    return { args, close: i }
}

function _maskCallArgs(code) {
    const re = /\b(ODBCOpenEx|ODBCOpen|AssignClientPassword)\s*\(/gi
    let out = '', last = 0, m
    while ((m = re.exec(code))) {
        const idx = SECRET_ARGS[m[1].toUpperCase()]
        const { args } = _args(code, m.index + m[0].length)
        const a = args[idx]
        if (!a) continue
        const raw = code.slice(a.start, a.end)
        const lead = raw.match(/^\s*/)[0], trail = raw.match(/\s*$/)[0]
        out += code.slice(last, a.start) + lead + `'${MASK}'` + trail
        last = a.end
        re.lastIndex = a.end
    }
    return out + code.slice(last)
}

function stripTiCredentials(code) {
    if (typeof code !== 'string' || !code) return code
    let s = _maskCallArgs(code)
    // secret-named variable = 'literal'
    s = s.replace(/\b([\w$]+)(\s*=\s*)'(?:[^']|'')*'/g, (all, name, eq) => SECRET_VAR.test(name) ? `${name}${eq}'${MASK}'` : all)
    // connection-string keys
    s = s.replace(/\b(PWD|Password|Pass)(\s*=\s*)([^;'"\s]+|"[^"]*"|\{[^}]*\})/gi, (all, k, eq) => `${k}${eq}${MASK}`)
    return s
}

// Object keys that hold a secret: password, userPassword, db_pass, pwd, client_secret,
// apiKey, token… — but not "passed" / "passing" (assertion counts) or "tokens".
const SECRET_KEY = /(^|[_-])(pass|passwd|pwd)$|password|secret|api_?key$|^token$|[_-]token$|Token$/i

function stripDatasourceCredentials(ds) {
    if (!ds || typeof ds !== 'object') return ds
    const out = Array.isArray(ds) ? [] : {}
    for (const [k, v] of Object.entries(ds)) {
        // a secret is text — a true/false or a number under a matching key (an assertion's
        // "pass": true) is not one, and masking it hid every assertion result
        if (SECRET_KEY.test(k) && v != null && v !== '' && typeof v !== 'boolean' && typeof v !== 'number') out[k] = MASK
        else if (typeof v === 'string') out[k] = stripTiCredentials(v)
        else if (v && typeof v === 'object') out[k] = stripDatasourceCredentials(v)
        else out[k] = v
    }
    return out
}

// Every tool answer goes through this before it reaches the agent — the deploy
// checks, diffs, Lens HTML and error text included, not just get_process — so
// "TI passwords are always removed" holds for every output, not a list of tools.
function scrubResult(res) {
    if (!res?.content) return res
    return {
        ...res,
        content: res.content.map(item => {
            if (item?.type !== 'text' || typeof item.text !== 'string') return item
            let data
            try { data = JSON.parse(item.text) } catch { return { ...item, text: stripTiCredentials(item.text) } }
            if (typeof data === 'string') return { ...item, text: JSON.stringify(stripTiCredentials(data)) }
            if (!data || typeof data !== 'object') return item
            return { ...item, text: JSON.stringify(stripDatasourceCredentials(data), null, 2) }
        }),
    }
}

// ── Audit helpers ────────────────────────────────────────────────────────────

// The objects a call names, for the audit row.
function objectOf(args = {}) {
    const parts = []
    for (const k of ['cube', 'dimension', 'process', 'view', 'subset', 'chore', 'name', 'element', 'target', 'id']) {
        if (args[k] != null && args[k] !== '') parts.push(`${k}=${args[k]}`)
    }
    const cubes = cubesInMdx(args.mdx)
    if (cubes.length && args.cube == null) parts.push(`cube=${cubes.join(',')}`)
    if (args.pattern) parts.push(`pattern=${args.pattern}`)
    return parts.join(' ') || null
}

// How many rows a tool's answer carried: array length, or cells / hits / values.
function countRows(data) {
    if (Array.isArray(data)) return data.length
    if (data && typeof data === 'object') {
        for (const k of ['cells', 'hits', 'results', 'rows', 'values', 'attributes']) {
            const v = data[k]
            if (Array.isArray(v)) return v.length
            if (v && typeof v === 'object') return Object.keys(v).length
        }
        return 1
    }
    return data == null ? 0 : 1
}

module.exports = {
    READ_TOOLS, WRITE_TOOLS, classify, resolveMode,
    BUILT_IN_DENY, POLICY_FILE, buildPolicy, loadPolicy, matches, allowed, refusal, checkArgs,
    cubesInMdx, whereMembers, cellMembers, redactCells, redactAttributes, maskPolicyFor, MASK,
    stripTiCredentials, stripDatasourceCredentials, scrubResult, objectOf, countRows,
}
