'use strict'

// ── Release complement apply helpers ─────────────────────────────────────────
// TM1 Git's pull never applies subsets or views, so a release applies them over
// REST from the release commit's repo files (see applyReleaseComplement in
// git-release.js). These helpers read the repo export formats: MDX vs static
// subsets, MDX vs native views, and view axes. (The old drift-revert path that
// also lived here was retired — see git-drift.js.)

// Element name from the exported subset format: Elements are
// { "@id": "Dimensions('..')/Hierarchies('..')/Elements('NAME')" }.
function subsetMemberName(el, dim, hier) {
    if (typeof el === 'string') return el
    if (el?.Name) return String(el.Name)
    const m = String(el?.['@id'] ?? '').match(/'([^']+)'\)?$/m)
    if (m) return m[1]
    return null
}

// TM1 Git exports a process as one .ti file with #region Prolog / Metadata /
// Data / Epilog blocks. Split them back into the four procedures.
function splitTi(text) {
    const grab = (key) => {
        const m = String(text ?? '').match(new RegExp(`#region\\s+${key}\\s*\\r?\\n([\\s\\S]*?)#endregion`, 'i'))
        return m ? m[1].replace(/\r/g, '').trimEnd() : ''
    }
    if (!/#region\s+Prolog/i.test(String(text ?? ''))) return null
    return { prolog: grab('Prolog'), metadata: grab('Metadata'), data: grab('Data'), epilog: grab('Epilog') }
}

// A view placement from a repo export: either a NAMED subset
// ({ Subset: { @id: '…/Subsets(\'NAME\')' } }) or an inline expression
// ({ Subset: { Hierarchy: {@id}, Expression }, Selected: {@id} }).
function parseViewPlacement(p) {
    const subId = String(p?.Subset?.['@id'] ?? '')
    const named = subId.match(/Subsets\('([^']+)'\)/)?.[1] ?? null
    const dim = named
        ? String(subId).match(/Dimensions\('([^']+)'\)/)?.[1]
        : String(p?.Subset?.Hierarchy?.['@id'] ?? '').match(/Dimensions\('([^']+)'\)/)?.[1]
    if (named) return { dimension: dim, subset: named }
    const out = { dimension: dim, customExpr: p?.Subset?.Expression ?? null }
    const member = String(p?.Selected?.['@id'] ?? '').match(/Elements\('([^']+)'\)/)?.[1] ?? null
    if (member) out.member = member
    return out
}

// Apply a subset from its repo file: a DYNAMIC subset keeps its MDX Expression;
// a STATIC subset is applied by its element list. (This is the fix for treating
// every exported subset as static.)
async function applySubset(tm1, det, content) {
    const sub = JSON.parse(content)
    if (sub.Expression) {
        await tm1.saveSubset(det.dim, det.name, sub.Expression, det.hierarchy ?? det.dim)
        return { type: 'subset', name: `${det.name} (${det.dim})`, mode: 'mdx' }
    }
    const members = (sub.Elements ?? []).map(el => subsetMemberName(el, det.dim, det.hierarchy ?? det.dim)).filter(Boolean)
    await tm1.saveStaticSubset(det.dim, det.name, members, det.hierarchy ?? det.dim)
    return { type: 'subset', name: `${det.name} (${det.dim})`, mode: 'static', n: members.length }
}

// Apply a view from its repo file: an MDX view (exported @type MDXView, its MDX in
// the sibling .mdx file) keeps its MDX; a native view is rebuilt from the exported
// Rows / Columns / Titles placements.
async function applyView(tm1, det, content) {
    const view = JSON.parse(content)
    if (view['@type'] === 'MDXView' || (view['MDX@Code.link'] && !Array.isArray(view.Rows))) {
        const mdx = view.MDX ?? det.mdx
        if (!mdx) throw new Error('MDX view has no MDX text (missing .mdx sibling)')
        await tm1.saveView(det.cube, det.name, mdx)
        return { type: 'view', name: `${det.name} (${det.cube})`, mode: 'mdx' }
    }
    await tm1.saveNativeView(det.cube, det.name, {
        rows: (view.Rows ?? []).map(parseViewPlacement),
        columns: (view.Columns ?? []).map(parseViewPlacement),
        titles: (view.Titles ?? []).map(parseViewPlacement),
        suppressEmptyRows: view.SuppressEmptyRows,
        suppressEmptyColumns: view.SuppressEmptyColumns,
    })
    return { type: 'view', name: `${det.name} (${det.cube})`, mode: 'native' }
}

module.exports = { splitTi, subsetMemberName, parseViewPlacement, applySubset, applyView }