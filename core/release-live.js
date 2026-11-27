'use strict'

// ── Build a release from the target's Live plus the change set's records ────
// Part G. The release starts from the target's own latest state, not from DEV,
// so anything the target loaded or changed itself is preserved ("if it's in PROD,
// it's correct"). Only the change set's RECORDED changes are applied on top.
//
// The functions here are pure: JSON documents in, JSON documents out, with a list
// of `stops` rather than a throw. The orchestrator in git-release.js reads Git and
// writes the release tree; keeping the rules here lets every case be tested
// without a server.

const TYPES = { n: 'Numeric', numeric: 'Numeric', s: 'String', string: 'String', c: 'Consolidated', consolidated: 'Consolidated', alias: 'Alias' }
const longType = (t) => TYPES[String(t ?? '').toLowerCase()] ?? (t == null ? 'Numeric' : String(t))
const shortType = (t) => {
    const x = String(t ?? '').toLowerCase()
    if (x.startsWith('num') || x === 'n') return 'N'
    if (x.startsWith('cons') || x === 'c') return 'C'
    return 'S'
}
const norm = (s) => String(s ?? '').toLowerCase()
const same = (a, b) => norm(a) === norm(b)

function clone(value) {
    return JSON.parse(JSON.stringify(value))
}

function elementName(e) {
    return e?.Name ?? e?.name ?? String(e?.['@id'] ?? '').match(/Elements\('([^']+)'\)/)?.[1] ?? null
}

function elementType(e) {
    return longType(e?.Type ?? e?.type ?? 'Numeric')
}

function edgeParent(e) { return e?.ParentName ?? e?.parent ?? null }
function edgeChild(e) { return e?.ComponentName ?? e?.child ?? null }
function edgeWeight(e) { return Number(e?.Weight ?? e?.weight ?? 1) }

function docShape(doc) {
    const elementsKey = Array.isArray(doc?.Elements) ? 'Elements' : Array.isArray(doc?.elements) ? 'elements' : 'Elements'
    const edgesKey = Array.isArray(doc?.Edges) ? 'Edges' : Array.isArray(doc?.edges) ? 'edges' : 'Edges'
    if (!Array.isArray(doc[elementsKey])) doc[elementsKey] = []
    if (!Array.isArray(doc[edgesKey])) doc[edgesKey] = []
    return { elementsKey, edgesKey }
}

// Apply this change set's element records to the target's hierarchy file.
//
// Rules (Part G.3):
//   * a change applies only if Live still has the recorded BEFORE value, or
//     already has the AFTER value;
//   * the target's element order is kept, new elements are appended in the
//     records' order;
//   * an element the target removed stays removed — if a record needs it, stop;
//   * a type change taken from the target is reported so Review can ask.
//
// Returns { doc, applied, already, stops, typeChanges, targetAdded, targetRemoved }.
function applyDimensionChanges(liveDoc, changes, { baseDoc = null } = {}) {
    const doc = clone(liveDoc ?? {})
    const { elementsKey, edgesKey } = docShape(doc)
    const els = doc[elementsKey]
    const edges = doc[edgesKey]
    const stops = []
    const applied = []
    const already = []
    const typeChanges = []

    // What the target itself added/removed, captured BEFORE this change set's
    // records are replayed — otherwise a record-added element reads as the target's.
    const initialLiveNames = new Set(els.map(elementName).filter(Boolean))
    const baseNames = new Set((baseDoc ? (baseDoc.Elements ?? baseDoc.elements ?? []) : []).map(elementName).filter(Boolean))
    const targetAdded = baseDoc ? [...initialLiveNames].filter(n => !baseNames.has(n)) : []
    const targetRemoved = baseDoc ? [...baseNames].filter(n => !initialLiveNames.has(n)) : []

    const find = (name) => els.find(e => same(elementName(e), name)) ?? null
    const findEdge = (parent, child) => edges.find(e => same(edgeParent(e), parent) && same(edgeChild(e), child)) ?? null
    const removeEdge = (parent, child) => {
        const i = edges.findIndex(e => same(edgeParent(e), parent) && same(edgeChild(e), child))
        if (i >= 0) edges.splice(i, 1)
        return i >= 0
    }
    const addEdge = (parent, child, weight) => {
        if (!findEdge(parent, child)) edges.push({ ParentName: parent, ComponentName: child, Weight: weight ?? 1 })
    }
    const renameInEdges = (from, to) => {
        for (const e of edges) {
            if (same(edgeParent(e), from)) e.ParentName = to
            if (same(edgeChild(e), from)) e.ComponentName = to
        }
    }

    for (const c of changes?.elements ?? []) {
        if (c.action === 'add') {
            let el = find(c.name)
            if (el) {
                const hasType = elementType(el)
                if (c.type && !same(hasType, longType(c.type))) {
                    stops.push(`${c.name}: the target already has it as ${hasType}, this change set adds it as ${longType(c.type)}`)
                } else {
                    already.push(`element ${c.name} already on the target`)
                }
                // The parent may still be the change set's to place.
                if (c.parent) {
                    if (!find(c.parent)) stops.push(`${c.name}: its parent ${c.parent} is not on the target`)
                    else if (!findEdge(c.parent, c.name)) addEdge(c.parent, c.name, c.weight)
                }
                continue
            }
            if (c.parent && !find(c.parent)) {
                stops.push(`${c.name}: its parent ${c.parent} is not on the target (the target removed it)`)
                continue
            }
            el = { Name: c.name, Type: longType(c.type) }
            els.push(el)
            if (c.parent) addEdge(c.parent, c.name, c.weight)
            applied.push(`added element ${c.name}`)
            continue
        }

        if (c.action === 'delete') {
            const el = find(c.name)
            if (!el) { already.push(`element ${c.name} already gone`); continue }
            if (c.before?.parent && !findEdge(c.before.parent, c.name)) {
                // The target moved it elsewhere; deleting it would remove something
                // this change set did not describe.
                const parents = edges.filter(e => same(edgeChild(e), c.name)).map(edgeParent).filter(Boolean)
                if (parents.length) {
                    stops.push(`${c.name}: the target moved it under ${parents.join(', ')}, not ${c.before.parent}`)
                    continue
                }
            }
            const i = els.indexOf(el)
            els.splice(i, 1)
            for (let k = edges.length - 1; k >= 0; k--) {
                if (same(edgeParent(edges[k]), c.name) || same(edgeChild(edges[k]), c.name)) edges.splice(k, 1)
            }
            applied.push(`removed element ${c.name}`)
            continue
        }

        if (c.action === 'rename') {
            const from = find(c.from)
            const to = find(c.to)
            if (!from && to) { already.push(`element ${c.from} already renamed to ${c.to}`); continue }
            if (!from) { stops.push(`${c.from}: the target does not have it, so it cannot be renamed to ${c.to}`); continue }
            if (to) { stops.push(`${c.to}: the target already has an element with that name`); continue }
            from.Name = c.to
            renameInEdges(c.from, c.to)
            applied.push(`renamed ${c.from} → ${c.to}`)
            continue
        }

        if (c.action === 'type') {
            const el = find(c.name)
            if (!el) { stops.push(`${c.name}: the target does not have it, so its type cannot change`); continue }
            const current = elementType(el)
            const want = longType(c.to)
            if (same(current, want)) { already.push(`type of ${c.name} already ${want}`); continue }
            if (c.from && !same(current, longType(c.from))) {
                stops.push(`${c.name}: the target has type ${current}, the record expects ${longType(c.from)} before changing to ${want}`)
                continue
            }
            el.Type = want
            typeChanges.push({ element: c.name, from: current, to: want })
            applied.push(`type of ${c.name}: ${current} → ${want}`)
            continue
        }

        if (c.action === 'link') {
            if (!find(c.parent)) { stops.push(`${c.name}: its parent ${c.parent} is not on the target`); continue }
            if (!find(c.name)) { stops.push(`${c.name}: the target does not have it, so it cannot be placed under ${c.parent}`); continue }
            const e = findEdge(c.parent, c.name)
            if (e) {
                if (c.weight != null && Number(edgeWeight(e)) !== Number(c.weight)) {
                    stops.push(`${c.name}: the target has it under ${c.parent} with weight ${edgeWeight(e)}, the record places it with ${c.weight}`)
                } else already.push(`${c.name} already under ${c.parent}`)
                continue
            }
            addEdge(c.parent, c.name, c.weight)
            applied.push(`placed ${c.name} under ${c.parent}`)
            continue
        }

        if (c.action === 'unlink') {
            const e = findEdge(c.parent, c.name)
            if (!e) { already.push(`${c.name} already not under ${c.parent}`); continue }
            if (c.weight != null && Number(edgeWeight(e)) !== Number(c.weight)) {
                stops.push(`${c.name}: the target has weight ${edgeWeight(e)} under ${c.parent}, the record removes weight ${c.weight}`)
                continue
            }
            removeEdge(c.parent, c.name)
            applied.push(`removed ${c.name} from ${c.parent}`)
            continue
        }

        if (c.action === 'weight') {
            const e = findEdge(c.parent, c.name)
            if (!e) { stops.push(`${c.name}: the target does not have it under ${c.parent}`); continue }
            const current = edgeWeight(e)
            const want = Number(c.to)
            if (current === want) { already.push(`weight ${c.name} under ${c.parent} already ${want}`); continue }
            if (c.from != null && current !== Number(c.from)) {
                stops.push(`${c.name}: weight under ${c.parent} is ${current} on the target, the record expects ${c.from} before changing to ${want}`)
                continue
            }
            e.Weight = want
            applied.push(`weight of ${c.name} under ${c.parent}: ${current} → ${want}`)
            continue
        }
    }

    // What the target itself added/removed, for Review and the report — captured
    // before the records were replayed above (see initialLiveNames).
    return { doc, applied, already, stops, typeChanges, targetAdded, targetRemoved }
}

// Apply a recorded chore change to the target's chore file (Part G.8).
// A chore is schedule (StartTime, Frequency, ExecutionMode) plus steps. The on/off
// flag is never in Git and never part of a deploy.
//
// `baseJson` is what the target was last given — needed to tell "only DEV moved
// the schedule" from "the target moved it too".
function applyChoreChanges(liveJson, change, { baseJson = null } = {}) {
    const doc = clone(liveJson ?? {})
    const stops = []
    const applied = []
    const already = []
    if (!change) return { doc, applied, already, stops }
    const before = change.before ?? {}
    const after = change.after ?? {}
    for (const field of ['StartTime', 'Frequency', 'ExecutionMode']) {
        if (!(field in after) && !(field in before)) continue
        const live = doc[field] ?? null
        const b = before[field] ?? null
        const a = after[field] ?? live
        if (String(live) === String(a)) { already.push(`${field} already ${a}`); continue }
        const base = baseJson ? (baseJson[field] ?? null) : null
        if (baseJson && String(live) !== String(base)) {
            stops.push(`${field}: the target changed it to ${live}, this change set sets ${a} (was ${b})`)
            continue
        }
        doc[field] = a
        applied.push(`${field}: ${live} → ${a}`)
    }
    return { doc, applied, already, stops }
}

// ── Attributes (Part G.7) ───────────────────────────────────────────────────
// Compare only what the change set RECORDED. Never wholesale: a value the change
// set did not record is never written (Sarah stays Grade 4).

function attrDoc(files, dim) {
    const doc = files?.[dim]
    if (!doc) return { attributes: [], elements: [], byElement: new Map(), byAttr: new Map() }
    const attributes = Array.isArray(doc.attributes) ? doc.attributes : []
    const elements = Array.isArray(doc.elements) ? doc.elements : []
    const byElement = new Map(elements.map(e => [norm(e.Name), e]))
    const byAttr = new Map(attributes.map(a => [norm(a.Name), a]))
    return { attributes, elements, byElement, byAttr }
}

function valueOf(doc, element, attribute) {
    const e = doc.byElement.get(norm(element))
    if (!e) return undefined
    const v = (e.Values ?? e.values ?? {})[attribute]
    return v === undefined ? '' : v
}

// Build the writes Deploy runs after the pull. `records.dimensions` is the shape
// from recorded-changes.js; live/base are parsed attrs documents per dimension.
function planAttributeChanges(records, { live = {}, base = {}, haveBase = false } = {}) {
    const defs = []
    const values = []
    const already = []
    const stops = []
    const notes = []

    for (const [dim, record] of records?.dimensions ?? []) {
        if (!record) continue
        const l = attrDoc(live, dim)
        const b = attrDoc(base, dim)
        const dimensionHasTargetFile = !!live[dim]

        // Definitions.
        for (const d of record.attrDefs ?? []) {
            if (!d.name) continue
            const onLive = l.byAttr.get(norm(d.name)) ?? null
            if (d.action === 'add') {
                if (onLive) {
                    if (same(longType(onLive.Type), longType(d.type))) already.push(`${dim}.${d.name} attribute already exists`)
                    else stops.push(`${dim}.${d.name}: the target has attribute type ${longType(onLive.Type)}, this change set creates ${longType(d.type)}`)
                } else defs.push({ dim, action: 'add', name: d.name, type: longType(d.type) })
            } else if (d.action === 'delete') {
                if (onLive) defs.push({ dim, action: 'delete', name: d.name, type: longType(onLive.Type) })
                else already.push(`${dim}.${d.name} attribute already gone`)
            } else if (d.action === 'type') {
                if (!onLive) stops.push(`${dim}.${d.name}: the target does not have the attribute, its type cannot change`)
                else if (same(longType(onLive.Type), longType(d.to))) already.push(`${dim}.${d.name} attribute type already ${longType(d.to)}`)
                else if (d.from && !same(longType(onLive.Type), longType(d.from))) {
                    stops.push(`${dim}.${d.name}: the target has attribute type ${longType(onLive.Type)}, the record expects ${longType(d.from)} before changing to ${longType(d.to)}`)
                } else defs.push({ dim, action: 'type', name: d.name, from: longType(onLive.Type), to: longType(d.to) })
            }
        }

        // Values.
        const seen = new Set()
        for (const v of record.values ?? []) {
            const key = `${norm(v.element)}::${norm(v.attribute)}`
            if (seen.has(key)) continue
            seen.add(key)
            if (!dimensionHasTargetFile) { notes.push(`${dim}: not on the target — its recorded values are not written`); continue }
            const lv = valueOf(l, v.element, v.attribute)
            if (lv === undefined) { notes.push(`${dim}.${v.element}: not on the target — its ${v.attribute} value is not written`); continue }
            const after = v.after ?? ''
            if (String(lv) === String(after)) { already.push(`${dim}.${v.element}.${v.attribute} already ${after}`); continue }
            const bv = valueOf(b, v.element, v.attribute)
            if (haveBase && String(lv) !== String(bv) && String(lv) !== String(after)) {
                stops.push(`${dim}.${v.element}.${v.attribute}: the target is '${lv}', last deployed was '${bv}', this change set sets '${after}' — both sides changed it`)
                continue
            }
            const attrDef = l.byAttr.get(norm(v.attribute))
            const type = attrDef ? longType(attrDef.Type) : (v.attribute.toLowerCase().includes('alias') ? 'Alias' : 'String')
            values.push({ dim, element: v.element, attribute: v.attribute, value: after, type })
        }
    }

    // Aliases must stay unique against Live (Part G.7). A clash stops the build —
    // two elements with one alias would make a lookup silently pick either.
    const aliasStops = []
    const aliasAdds = new Map()
    for (const w of values) {
        if (!/^alias$/i.test(w.type) || String(w.value ?? '') === '') continue
        const key = `${norm(w.dim)}::${norm(w.attribute)}`
        if (!aliasAdds.has(key)) aliasAdds.set(key, [])
        aliasAdds.get(key).push(w)
    }
    for (const [key, writes] of aliasAdds) {
        const attribute = key.split('::')[1]
        const l = attrDoc(live, writes[0].dim)
        const owners = new Map()
        for (const e of l.elements) {
            const val = (e.Values ?? e.values ?? {})[writes[0].attribute]
            if (val !== undefined && val !== '') owners.set(String(val), e.Name)
        }
        for (const w of writes) {
            const val = String(w.value)
            const owner = owners.get(val)
            if (owner && !same(owner, w.element)) aliasStops.push(`${w.dim}.${w.attribute}: '${val}' is already the alias of ${owner}, and this change set sets it on ${w.element}`)
            owners.set(val, w.element)
        }
        const seen = new Set()
        for (const [val] of owners) {
            if (!val) continue
            if (seen.has(val)) aliasStops.push(`${writes[0].dim}.${attribute}: '${val}' would belong to more than one element`)
            seen.add(val)
        }
    }
    stops.push(...aliasStops)

    return { defs, values, already, stops, notes }
}

// Check a written hierarchy file against Live (Part G.4). By construction the
// writer starts from Live; this is the safety net that says so, because a bug in
// the writer must stop the release, not ship a lost element.
//
// Returns [] when every difference matches a recorded change and every Live
// element/parent remains unless the records removed it.
function checkWrittenHierarchy(liveDoc, writtenDoc, changes) {
    const problems = []
    const liveEls = new Map((liveDoc?.Elements ?? liveDoc?.elements ?? []).map(e => [norm(elementName(e)), e]))
    const wroteEls = new Map((writtenDoc?.Elements ?? writtenDoc?.elements ?? []).map(e => [norm(elementName(e)), e]))
    const liveEdges = new Set((liveDoc?.Edges ?? liveDoc?.edges ?? []).map(e => `${norm(edgeParent(e))}::${norm(edgeChild(e))}`))
    const wroteEdges = new Set((writtenDoc?.Edges ?? writtenDoc?.edges ?? []).map(e => `${norm(edgeParent(e))}::${norm(edgeChild(e))}`))

    const rec = changes ?? { elements: [] }
    const ops = rec.elements ?? []
    const removed = new Set(ops.filter(o => o.action === 'delete').map(o => norm(o.name)))
    const renamedFrom = new Set(ops.filter(o => o.action === 'rename').map(o => norm(o.from)))
    const renamedTo = new Map(ops.filter(o => o.action === 'rename').map(o => [norm(o.from), norm(o.to)]))
    const added = new Set(ops.filter(o => o.action === 'add').map(o => norm(o.name)))
    const linked = new Set(ops.filter(o => o.action === 'link').map(o => `${norm(o.parent)}::${norm(o.name)}`))
    const unlinked = new Set(ops.filter(o => o.action === 'unlink').map(o => `${norm(o.parent)}::${norm(o.name)}`))

    for (const [key, e] of liveEls) {
        const target = renamedTo.get(key) ?? key
        if (wroteEls.has(target)) continue
        if (removed.has(key) || renamedFrom.has(key)) continue
        problems.push(`element ${elementName(e)} was in the target's Live copy but is not in the written file, and no record removed it`)
    }
    for (const [key] of wroteEls) {
        if (liveEls.has(key) || added.has(key)) continue
        if ([...renamedTo.values()].includes(key)) continue
        problems.push(`element ${key} is in the written file but was not on the target and no record added it`)
    }
    for (const key of liveEdges) {
        if (wroteEdges.has(key)) continue
        const [parent, child] = key.split('::')
        if (removed.has(child) || unlinked.has(key)) continue
        problems.push(`parent link ${parent} → ${child} was on the target but is not in the written file, and no record removed it`)
    }
    for (const key of wroteEdges) {
        if (liveEdges.has(key) || linked.has(key)) continue
        if (removed.has(key.split('::')[1])) continue
        problems.push(`parent link ${key.replace('::', ' → ')} is in the written file but was not on the target and no record added it`)
    }
    return problems
}

module.exports = {
    applyDimensionChanges, applyChoreChanges, planAttributeChanges, checkWrittenHierarchy,
    longType, shortType, elementName, elementType, edgeParent, edgeChild, edgeWeight, valueOf, attrDoc,
}
