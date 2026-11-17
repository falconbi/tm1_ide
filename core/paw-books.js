'use strict'

// Walk PAW's content tree and return the books whose tabs reference one TM1
// view (or any view of a cube). PAW session/CSRF handling stays in the route.
function collectViews(items) {
    const views = []
    for (const item of items) {
        const feats = item.features || {}
        for (const tm1 of [feats.PAProperties?.tm1, feats.Models_internal?.data?.parentStore]) {
            if (!tm1?.cube) continue
            const v = { server: tm1.server || '', cube: tm1.cube || '', view: tm1.view || '' }
            if (!views.some(x => x.server === v.server && x.cube === v.cube && x.view === v.view)) views.push(v)
        }
        if (item.items) {
            for (const v of collectViews(item.items)) {
                if (!views.some(x => x.server === v.server && x.cube === v.cube && x.view === v.view)) views.push(v)
            }
        }
    }
    return views
}

function extractTabs(content) {
    if (!content || !content.layout) return []
    const tabs = []
    for (const item of content.layout.items || []) {
        if (item.type === 'container') {
            tabs.push({ name: item.title?.translationTable?.Default || 'Tab', views: collectViews(item.items || []) })
        }
    }
    return tabs
}

async function findBooks({ pawSession, csrf, base, server, cube, view }) {
    const encodePath = p => encodeURIComponent(encodeURIComponent(p)) // PAW Assets path, not a TM1 key
    const books = []
    const walk = async path => {
        const url = `${base}/Assets(path='${encodePath(path)}')/Assets`
        try {
            const r = await pawSession.get(url, {
                headers: { 'ba-sso-authenticity': csrf },
                params: { '$select': 'name,id,path,type' },
            })
            for (const item of (r.data?.value ?? [])) {
                if (item.type === 'folder') await walk(item.path)
                else if (item.type === 'dashboard' || item.type === 'workbench') {
                    try {
                        const book = await pawSession.get(
                            `${base}/Assets(path='${encodePath(item.path)}')?$expand=content`,
                            { headers: { 'ba-sso-authenticity': csrf } }
                        )
                        const found = extractTabs(book.data?.content).some(tab =>
                            tab.views.some(v => v.cube === cube && (!view || v.view === view) && v.server === server))
                        if (found) books.push({ name: item.name, path: item.path, id: item.id })
                    } catch { /* ignore unreadable books */ }
                }
            }
        } catch { /* ignore inaccessible folders */ }
    }
    await walk('/shared')
    await walk('/users')
    return books
}

module.exports = { findBooks, collectViews, extractTabs }
