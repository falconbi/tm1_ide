'use strict'

// ── What a change set recorded, in a shape a release can replay (Part F/G) ──
// A change set's changes come from its OWN records, never from comparing two Git
// saves: Git only holds whole-server saves, so a colleague's close (or a sync)
// while this set is open would hide its work behind a compare of saves.
//
// Every IDE edit and every captured TI run writes a log entry. Where an entry
// carries before_state / after_state, this module reads the structured values.
// Older entries only have a human detail string; those are parsed for the shapes
// the routes have always written (ELEMENT_ADDED, ELEMENT_DELETED, …). An entry
// that cannot be made structured is marked `whole`, and the release falls back to
// DEV's file for that object — never to a guess.

const norm = (s) => String(s ?? '').toLowerCase()

function parseJson(value) {
    if (value == null) return null
    if (typeof value === 'object') return value
    try { return JSON.parse(value) } catch { return null }
}

function idName(value) {
    return String(value ?? '').match(/Elements\('([^']+)'\)/)?.[1] ?? null
}

function elementName(e) {
    return e?.element ?? e?.name ?? e?.Name ?? idName(e?.['@id']) ?? null
}

function detailText(e) {
    const d = e?.detail
    if (d == null) return ''
    if (typeof d === 'string') return d
    return d.text ?? d.message ?? ''
}

const TYPE_LONG = { n: 'Numeric', numeric: 'Numeric', s: 'String', string: 'String', c: 'Consolidated', consolidated: 'Consolidated', alias: 'Alias' }
function longType(t) {
    return TYPE_LONG[String(t ?? '').toLowerCase()] ?? (t == null ? 'Numeric' : String(t))
}

function newDimensionRecord() {
    return { elements: [], whole: false, wholeReason: null, attrDefs: [], values: [], hierarchies: new Map() }
}

// The dimension and hierarchy a HIERARCHY_* entry belongs to. New entries carry
// both in before/after state; older ones only have the dimension as the object
// name and the hierarchy in `detail` ("Alt", "hierarchy Alt", or the refresh
// shape "Alt" with afterState.hierarchy). An entry that cannot be read this way
// is left to the whole-dimension fallback rather than guessed.
function hierarchyInfo(entry) {
    const before = parseJson(entry.before_state)
    const after = parseJson(entry.after_state)
    let hierarchy = after?.hierarchy ?? before?.hierarchy ?? after?.Hierarchy ?? before?.Hierarchy ?? null
    let dimension = after?.dimension ?? before?.dimension ?? after?.Dimension ?? before?.Dimension ?? null
    const text = detailText(entry).trim()
    if (!hierarchy) {
        const m = text.match(/^hierarchy\s+(.+?)(?:\s+on\s+(.+))?$/i)
        if (m) {
            hierarchy = m[1]?.trim() || null
            dimension = dimension ?? (m[2]?.trim() || null)
        }
    }
    if (!dimension && entry?.object_name) dimension = entry.object_name
    if (!hierarchy || !dimension) return null
    return { dimension, hierarchy }
}

// Parse one log entry into zero or more element/edge operations for its dimension.
// Only shapes a release can apply exactly are returned; everything else sets
// `whole` so the caller knows this change set cannot be replayed element by element.
function elementOps(entry) {
    const before = parseJson(entry.before_state)
    const after = parseJson(entry.after_state)
    const text = detailText(entry)
    const action = String(entry.action ?? '')
    const hierarchy = after?.hierarchy ?? before?.hierarchy ?? null
    const out = []

    if (action === 'ELEMENT_ADDED') {
        let name = elementName(after) ?? null
        let parent = after?.parent ?? null
        let type = longType(after?.type)
        let weight = after?.weight ?? 1
        if (!name) {
            // A bulk/summary row ("3 elements, 2 edges in Alt") names no element and
            // must never become one.
            if (/^\d+\s+elements?\b/i.test(text)) return []
            const m = text.match(/^(.*?)(?: under (.*?))?(?: before .*)?$/)
            name = m?.[1]?.trim() || null
            parent = m?.[2]?.trim() || null
        }
        if (name) out.push({ action: 'add', name, type, parent, weight, hierarchy })
        return out
    }
    if (action === 'ELEMENT_DELETED') {
        let name = elementName(before) ?? (String(text || '').trim() || null)
        if (name) out.push({ action: 'delete', name, hierarchy, before: { parent: before?.parent ?? null, type: before?.type ? longType(before.type) : null, weight: before?.weight ?? null } })
        return out
    }
    if (action === 'ELEMENT_RENAMED') {
        let from = before?.element ?? before?.name ?? null
        let to = after?.element ?? after?.name ?? null
        if (!from || !to) {
            const m = text.match(/^(.*?)\s*→\s*(.*)$/)
            from = from ?? (m?.[1]?.trim() || null)
            to = to ?? (m?.[2]?.trim() || null)
        }
        if (from && to) out.push({ action: 'rename', from, to, hierarchy, type: after?.type ? longType(after.type) : undefined })
        return out
    }
    if (action === 'ELEMENT_LINKED' || action === 'ELEMENT_MOVED' || action === 'ELEMENT_COMPONENT_SET') {
        let name = elementName(after) ?? null
        let parent = after?.parent ?? null
        const m = text.match(/^(.*?) under (.*?)(?: before .*)?$/)
        name = name ?? (m?.[1]?.trim() || null)
        parent = parent ?? (m?.[2]?.trim() || null)
        if (name && parent) out.push({
            action: 'link', name, parent, hierarchy, weight: after?.weight ?? 1,
            before: before ? { parent: before.parent ?? null, weight: before.weight ?? null } : null,
        })
        return out
    }
    if (action === 'EDGE_REMOVED' || action === 'ELEMENT_UNLINKED') {
        let name = elementName(before) ?? null
        let parent = before?.parent ?? null
        const m = text.match(/^(.*?)\s*·\s*removed\s*(.*)$/)
        parent = parent ?? (m?.[1]?.trim() || null)
        name = name ?? (m?.[2]?.trim() || null)
        if (name && parent) out.push({ action: 'unlink', name, parent, hierarchy, weight: before?.weight ?? null })
        return out
    }
    if (action === 'EDGE_WEIGHT_CHANGED' || action === 'EDGE_UPDATED') {
        const name = elementName(after) ?? elementName(before) ?? null
        const parent = after?.parent ?? before?.parent ?? null
        if (name && parent) out.push({ action: 'weight', name, parent, hierarchy, from: before?.weight ?? null, to: after?.weight ?? null })
        return out
    }
    if (action === 'ELEMENT_TYPE_CHANGED') {
        const name = elementName(after) ?? elementName(before) ?? null
        if (name) out.push({ action: 'type', name, hierarchy, from: before?.type ? longType(before.type) : null, to: after?.type ? longType(after.type) : null })
        return out
    }
    return null
}

// Read one change set's entries and return a replayable shape.
//   {
//     dimensions: Map(dim → { elements, whole, wholeReason, attrDefs, values }),
//     objects: { subset|view|cube|process|chore: Set(key) },
//     deletes: [{ type, name, parent }]
//   }
function recordedChanges(entries = []) {
    const dimensions = new Map()
    const objects = { subset: new Set(), view: new Set(), cube: new Set(), process: new Set(), chore: new Set() }
    const deletes = []
    const dim = (name) => {
        if (!dimensions.has(name)) dimensions.set(name, newDimensionRecord())
        return dimensions.get(name)
    }

    for (const e of entries ?? []) {
        const type = String(e.object_type ?? '')
        const action = String(e.action ?? '')
        const name = e.object_name ?? null

        if (type === 'dimension') {
            if (action === 'HIERARCHY_CREATED' || action === 'HIERARCHY_DELETED') {
                // The hierarchy's own file is created or removed (Part G.2). Recorded
                // by name so Build Release can carry/remove that file and its link.
                const info = hierarchyInfo(e)
                if (info) {
                    const d = dim(info.dimension)
                    d.hierarchies.set(info.hierarchy, { action: action === 'HIERARCHY_CREATED' ? 'create' : 'delete' })
                    continue
                }
                // An older row that cannot name dimension and hierarchy: fall through
                // to the whole-dimension rule below, never a guess.
            }
            if (action === 'HIERARCHY_UPDATED' || action === 'DIMENSION_CREATED' || action === 'DIMENSION_DELETED' || action === 'DIMENSION_UPDATED' || (action === 'HIERARCHY_CREATED' || action === 'HIERARCHY_DELETED')) {
                // A refresh, an import or a whole-hierarchy change has no per-element
                // records. It is applied as DEV's file, never guessed from the target.
                // (An unreadable HIERARCHY_* row lands here too, deliberately.)
                const d = dim(name)
                d.whole = true
                d.wholeReason = d.wholeReason ?? `${action} ${name}`
                if (action === 'DIMENSION_DELETED') deletes.push({ type: 'dimension', name })
                continue
            }
            const d = dim(name)
            const ops = elementOps(e)
            if (ops === null) {
                // A dimension row with an unknown shape. Only mark whole when it names
                // the dimension itself; process-run rows never reach this branch.
                if (action) { d.whole = true; d.wholeReason = d.wholeReason ?? `${action} ${name}` }
                continue
            }
            d.elements.push(...ops)
        } else if (type === 'attribute') {
            const d = dim(typeof e.detail === 'string' ? e.detail : (parseJson(e.detail)?.dimension ?? name))
            const attr = name
            const before = parseJson(e.before_state)
            const after = parseJson(e.after_state)
            if (action === 'ATTRIBUTE_CREATED') d.attrDefs.push({ action: 'add', name: attr, type: longType(after?.type ?? after?.Type ?? 'String') })
            else if (action === 'ATTRIBUTE_DELETED') d.attrDefs.push({ action: 'delete', name: attr, type: longType(before?.type ?? before?.Type ?? 'String') })
            else if (action === 'ATTRIBUTE_TYPE_CHANGED') d.attrDefs.push({ action: 'type', name: attr, from: longType(before?.type ?? before?.Type), to: longType(after?.type ?? after?.Type) })
            else if (action === 'ATTRIBUTE_CONVERTED') { d.whole = true; d.wholeReason = d.wholeReason ?? `attribute ${attr} converted` }
        } else if (type === 'attribute-value') {
            const d0 = parseJson(e.detail) ?? {}
            const d = dim(d0.dimension)
            if (action === 'ATTRIBUTE_VALUE_SET' && d0.dimension && d0.element && d0.attribute) {
                d.values.push({
                    element: d0.element, attribute: d0.attribute,
                    hierarchy: d0.hierarchy ?? d0.dimension,
                    before: d0.before ?? null, after: d0.after ?? null,
                })
            } else if (d0.dimension) {
                d.whole = true
                d.wholeReason = d.wholeReason ?? 'attribute value change with no element/attribute recorded'
            }
        } else if (type === 'subset' || type === 'view' || type === 'cube' || type === 'process' || type === 'chore' || type === 'rules') {
            const t = type === 'rules' ? 'cube' : type
            const parent = (type === 'subset' || type === 'view') ? (e.detail ?? null) : null
            objects[t].add(`${norm(name)}::${norm(parent ?? '')}`)
            if (/_DELETED$/.test(action)) deletes.push({ type: t, name, parent })
            if (type === 'chore') {
                const before = parseJson(e.before_state)
                const after = parseJson(e.after_state)
                if (before || after) {
                    const c = objects.choreSchedules ??= new Map()
                    const key = norm(name)
                    const prev = c.get(key) ?? { name, before: null, after: null }
                    if (before) prev.before = prev.before ?? before
                    if (after) prev.after = after
                    c.set(key, prev)
                }
            }
        }
    }
    return { dimensions, objects, deletes }
}

// True when this change set touched an object (by type/name/parent).
function touched(c, type, name, parent = null) {
    if (type === 'dimension' || type === 'attribute') {
        const d = c.dimensions.get(name)
        return !!(d && (d.elements.length || d.whole || d.attrDefs.length || d.values.length || (d.hierarchies?.size ?? 0)))
    }
    const set = c.objects[type]
    return !!(set && set.has(`${norm(name)}::${norm(parent ?? '')}`))
}

// A readable one-line record for Review/report: "2 elements added, 1 moved".
function summariseDimension(record) {
    if (!record) return 'nothing recorded'
    if (record.whole) return record.wholeReason ?? 'whole dimension'
    const parts = []
    const count = (action) => (record.elements ?? []).filter(x => x.action === action).length
    if (count('add')) parts.push(`${count('add')} added`)
    if (count('delete')) parts.push(`${count('delete')} removed`)
    if (count('rename')) parts.push(`${count('rename')} renamed`)
    if (count('link')) parts.push(`${count('link')} placed`)
    if (count('unlink')) parts.push(`${count('unlink')} unplaced`)
    if (count('weight')) parts.push(`${count('weight')} weights`)
    if (count('type')) parts.push(`${count('type')} type changes`)
    if ((record.attrDefs ?? []).length) parts.push(`${record.attrDefs.length} attribute definitions`)
    if ((record.values ?? []).length) parts.push(`${record.values.length} attribute values`)
    return parts.join(', ') || 'nothing recorded'
}

module.exports = {
    recordedChanges, touched, summariseDimension, elementOps, hierarchyInfo,
    longType, parseJson, elementName, detailText, norm,
}
