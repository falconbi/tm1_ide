'use strict'

// ── Apply the release's attribute plan after the pull (Part G.7 / I.6) ──────
// The plan is built at Build Release from this change set's records only. Deploy
// applies exactly it: definitions first, then values. Nothing is inferred from DEV
// live, so a value the change set did not record is never written (Sarah).

const TYPE_OUT = { number: 'Numeric', numeric: 'Numeric', n: 'Numeric', text: 'String', string: 'String', s: 'String', alias: 'Alias' }
const outType = (t) => TYPE_OUT[String(t ?? '').toLowerCase()] ?? (t || 'String')
const writeType = (t) => /^num/i.test(String(t ?? '')) || /^n$/i.test(String(t ?? '')) ? 'N' : 'S'

async function applyAttributePlan(tm1, plan = {}) {
    const applied = []
    const errors = []
    for (const d of plan.defs ?? []) {
        try {
            if (d.action === 'delete') {
                await tm1.deleteElementAttribute(d.dim, d.name)
                applied.push(`deleted attribute ${d.dim}.${d.name}`)
            } else if (d.action === 'type') {
                await tm1.deleteElementAttribute(d.dim, d.name).catch(() => {})
                await tm1.createElementAttribute(d.dim, d.name, outType(d.to))
                applied.push(`attribute ${d.dim}.${d.name}: ${d.from} → ${d.to}`)
            } else {
                await tm1.createElementAttribute(d.dim, d.name, outType(d.type))
                applied.push(`created attribute ${d.dim}.${d.name}`)
            }
        } catch (e) {
            errors.push({ type: 'attribute', dim: d.dim, name: d.name, error: e.message })
        }
    }
    for (const v of plan.values ?? []) {
        try {
            await tm1.writeElementAttribute(v.dim, v.element, v.attribute, v.value ?? '', writeType(v.type))
            applied.push(`value ${v.dim}.${v.element}.${v.attribute}`)
        } catch (e) {
            errors.push({ type: 'attribute-value', dim: v.dim, element: v.element, attribute: v.attribute, error: e.message })
        }
    }
    return { applied, errors }
}

module.exports = { applyAttributePlan, outType, writeType }
