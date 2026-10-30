/**
 * Shared pivot · picker — choose what a dimension shows: everything, leaves
 * only, a named subset, or members ticked in its tree (with search).
 * Plain JavaScript; the Lens pivot opens it from a dimension chip.
 *
 *   openMemberPicker({
 *     anchor,                  // element to open under
 *     title,                   // e.g. the dimension's label
 *     elements,                // [{ Name, Type, Level, Components }] (elementTree)
 *     subsets: [...names],     // named subsets the Lens offers (optional)
 *     current,                 // { members } | { subset } | { memberSet: 'all' | 'leaf' }
 *     colors: { panel, ink, faint, rule, accent },
 *     onApply(choice),         // the same shape as current
 *   }) → { close() }
 */
import { buildHierarchy, computeVisibleNodes } from './tree.js'

const MAX_SHOWN = 1500   // tree rows drawn at once (search narrows larger dimensions)

export function openMemberPicker(o) {
    const c = Object.assign({ panel: '#fff', ink: '#16201f', faint: '#85908f', rule: '#dfe4e3', accent: '#0f766e' }, o.colors || {})
    const h = buildHierarchy(o.elements || [], o.title) || { nodes: {}, roots: [] }
    const cur = o.current || {}
    const ticked = new Set(cur.members || [])
    const open = new Set(h.roots)
    let mode = cur.subset ? 'subset:' + cur.subset : cur.members?.length ? 'members' : cur.memberSet === 'leaf' ? 'leaf' : 'all'
    let search = ''

    const box = document.createElement('div')
    box.setAttribute('data-member-picker', '')
    box.style.cssText = `position:fixed;z-index:60;width:320px;max-height:460px;display:flex;flex-direction:column;background:${c.panel};color:${c.ink};border:1px solid ${c.rule};border-radius:10px;box-shadow:0 12px 32px rgba(0,0,0,.2);font:13px system-ui,sans-serif`
    const r = o.anchor?.getBoundingClientRect ? o.anchor.getBoundingClientRect() : { left: 40, bottom: 40 }
    box.style.left = Math.max(8, Math.min(r.left, (window.innerWidth || 800) - 330)) + 'px'
    box.style.top = Math.min(r.bottom + 6, (window.innerHeight || 600) - 470) + 'px'
    const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
    const radio = (val, text) => `<label style="display:flex;gap:6px;align-items:center;padding:3px 0;cursor:pointer"><input type="radio" name="mp-mode" value="${esc(val)}"${mode === val ? ' checked' : ''}> ${text}</label>`

    function treeRows() {
        if (search) {
            const q = search.toLowerCase()
            return Object.keys(h.nodes).filter(id => id.toLowerCase().includes(q)).slice(0, MAX_SHOWN).map(id => ({ id, depth: 0 }))
        }
        return computeVisibleNodes(h.roots, h.nodes, open, 'parent').slice(0, MAX_SHOWN).map(id => ({ id, depth: h.nodes[id].depth || 0 }))
    }
    function draw() {
        const rows = treeRows()
        box.innerHTML =
            `<div style="padding:10px 12px;border-bottom:1px solid ${c.rule};font-weight:600">${esc(o.title || 'Members')}</div>` +
            `<div style="padding:8px 12px;border-bottom:1px solid ${c.rule}">` +
                radio('all', 'Everything') + radio('leaf', 'Lowest level only') +
                (o.subsets || []).map(s => radio('subset:' + s, 'Subset: <b>' + esc(s) + '</b>')).join('') +
                radio('members', 'Members I tick below') +
            `</div>` +
            `<div style="padding:8px 12px 4px"><input data-mp-search placeholder="Search…" value="${esc(search)}" style="width:100%;box-sizing:border-box;font:inherit;padding:5px 8px;border:1px solid ${c.rule};border-radius:7px;background:transparent;color:inherit"></div>` +
            `<div data-mp-tree style="overflow:auto;flex:1;padding:2px 8px 8px;opacity:${mode === 'members' ? 1 : 0.55}">` +
                rows.map(({ id, depth }) => {
                    const n = h.nodes[id], total = n && !n.isLeaf && n.children?.length
                    return `<div style="display:flex;align-items:center;gap:4px;padding:2px 0 2px ${depth * 14}px;white-space:nowrap">` +
                        (total && !search ? `<button type="button" data-mp-tog="${esc(id)}" style="border:0;background:none;color:${c.faint};cursor:pointer;width:16px;padding:0">${open.has(id) ? '▾' : '▸'}</button>` : '<span style="width:16px;display:inline-block"></span>') +
                        `<label style="display:flex;gap:6px;align-items:center;cursor:pointer;overflow:hidden;text-overflow:ellipsis"><input type="checkbox" data-mp-tick="${esc(id)}"${ticked.has(id) ? ' checked' : ''}><span${total ? ' style="font-weight:600"' : ''}>${esc(n?.label ?? id)}</span></label></div>`
                }).join('') +
                (rows.length >= MAX_SHOWN ? `<div style="color:${c.faint};padding:4px">Showing the first ${MAX_SHOWN} — search to narrow.</div>` : '') +
            `</div>` +
            `<div style="display:flex;gap:8px;align-items:center;padding:8px 12px;border-top:1px solid ${c.rule}">` +
                `<span style="color:${c.faint};font-size:12px;flex:1">${mode === 'members' ? ticked.size + ' ticked' : ''}</span>` +
                `<button type="button" data-mp-cancel style="font:inherit;padding:5px 10px;border:1px solid ${c.rule};border-radius:7px;background:transparent;color:inherit;cursor:pointer">Cancel</button>` +
                `<button type="button" data-mp-apply style="font:inherit;padding:5px 12px;border:0;border-radius:7px;background:${c.accent};color:#fff;font-weight:600;cursor:pointer"${mode === 'members' && !ticked.size ? ' disabled' : ''}>Apply</button>` +
            `</div>`
        const input = box.querySelector('[data-mp-search]')
        if (input && document.activeElement !== input && search) { input.focus(); input.setSelectionRange(search.length, search.length) }
    }

    box.addEventListener('click', e => {
        const t = e.target
        const tog = t.closest && t.closest('[data-mp-tog]')
        if (tog) { const id = tog.getAttribute('data-mp-tog'); open.has(id) ? open.delete(id) : open.add(id); draw(); return }
        if (t.closest && t.closest('[data-mp-cancel]')) { close(); return }
        if (t.closest && t.closest('[data-mp-apply]')) {
            const choice = mode === 'members' ? { members: [...ticked] } : mode === 'leaf' ? { memberSet: 'leaf' } : mode.startsWith('subset:') ? { subset: mode.slice(7) } : { memberSet: 'all' }
            close(); if (o.onApply) o.onApply(choice)
        }
    })
    box.addEventListener('change', e => {
        const t = e.target
        if (t.name === 'mp-mode') { mode = t.value; draw(); return }
        const id = t.getAttribute && t.getAttribute('data-mp-tick')
        if (id) { t.checked ? ticked.add(id) : ticked.delete(id); mode = 'members'; draw() }
    })
    box.addEventListener('input', e => { if (e.target.hasAttribute && e.target.hasAttribute('data-mp-search')) { search = e.target.value; draw() } })
    const outside = e => { if (!box.contains(e.target)) close() }
    const key = e => { if (e.key === 'Escape') close() }
    function close() {
        document.removeEventListener('mousedown', outside, true); document.removeEventListener('keydown', key)
        box.remove(); if (o.onClose) o.onClose()
    }
    draw()
    document.body.appendChild(box)
    setTimeout(() => { document.addEventListener('mousedown', outside, true); document.addEventListener('keydown', key) }, 0)
    return { close, el: box }
}
