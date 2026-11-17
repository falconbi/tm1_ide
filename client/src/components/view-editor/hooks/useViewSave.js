import { useCallback, useState } from 'react'
import { toast } from 'sonner'
import { buildMDX } from '@shared/pivot/mdx.js'
import { parseMdxToAxes } from '@/lib/view-editor/parse-mdx.js'
import { useSaveView, useSetDefaultView, useConflictCheck } from '@/hooks/useApi'
import { viewTabId } from '@/lib/tab-ids'

// Saving the view: save / save-as / default view / native conversion, plus the
// conflict banner and its diff. No effects.
export default function useViewSave({ tab, views, openTab, layout, mdx, run, isOriginallyNative }) {
    const { axes, suppressZeros, benchSlicers } = layout
    const { mode, mdx: mdxText, setMdxDirty } = mdx
    const { effAxes, drills } = run

    const saveView   = useSaveView()
    const setDefault = useSetDefaultView()

    const [showSaveMenu, setShowSaveMenu] = useState(false)
    const [saveConflict, setSaveConflict] = useState(null)
    const [conflictDiff, setConflictDiff] = useState(null)
    const [dismissedId, setDismissedId]   = useState(null)
    const { openConflict, checkBeforeSave } = useConflictCheck(tab.server, 'view', tab.viewName)

    const buildSavePayload = useCallback(() => {
        const usesAltH = [...axes.rows, ...axes.columns, ...axes.pages].some(d => d.hierarchy && d.hierarchy !== d.dimension)
        const drilled = Object.keys(drills).length > 0
        if (mode === 'visual' && (usesAltH || drilled)) {
            toast.info(drilled ? 'Saved as an MDX view, with what you opened' : 'This view uses an ALT H, so it is saved as an MDX view')
            return { mdx: buildMDX({ cube: tab.cube, ...effAxes, bench: benchSlicers, suppressZeros }) }
        }
        if (mode === 'visual') {
            return { nativeAxes: {
                rows: axes.rows, columns: axes.columns, titles: axes.pages,
                suppressEmptyRows:    suppressZeros === 'rows'    || suppressZeros === 'all',
                suppressEmptyColumns: suppressZeros === 'columns' || suppressZeros === 'all',
            } }
        }
        return { mdx: mdxText }
    }, [mode, mdxText, axes, effAxes, drills, suppressZeros, benchSlicers, tab.cube])

    const executeSave = useCallback((name) => {
        if (isOriginallyNative && mode === 'mdx') {
            if (!window.confirm('Saving in MDX mode will convert this Native view to MDX. This affects PAX and Architect users.\n\nContinue?')) return
        }
        const id = toast.loading('Saving view…')
        saveView.mutate(
            { server: tab.server, cube: tab.cube, name, ...buildSavePayload() },
            {
                onSuccess: () => { setMdxDirty(false); toast.success(`Saved "${name}"`, { id }) },
                onError:   e => toast.error(e.message, { id }),
            }
        )
    }, [isOriginallyNative, mode, buildSavePayload, tab.server, tab.cube, saveView, setMdxDirty])

    const handleSave = useCallback(async () => {
        const name = tab.viewName ?? prompt('View name?')
        if (!name) return
        if (tab.viewName) {
            const conflict = await checkBeforeSave()
            if (conflict) { setSaveConflict(conflict); return }
        }
        executeSave(name)
    }, [tab.viewName, checkBeforeSave, executeSave])

    const handleSaveAsNative = useCallback(() => {
        const name = prompt('Save as native view…')
        if (!name) return
        const parsed = parseMdxToAxes(mdxText)
        if (!parsed.columns.length && !parsed.rows.length) { toast.error('Could not parse MDX axes — switch to Visual mode and arrange dimensions first'); return }
        const id = toast.loading('Saving as Native…')
        saveView.mutate(
            { server: tab.server, cube: tab.cube, name, nativeAxes: { rows: parsed.rows, columns: parsed.columns, titles: parsed.pages } },
            {
                onSuccess: () => { setMdxDirty(false); toast.success(`Saved "${name}" as Native`, { id }) },
                onError:   e => toast.error(e.message, { id }),
            }
        )
    }, [mdxText, parseMdxToAxes, tab.server, tab.cube, tab.viewName, saveView, setMdxDirty])

    const handleSaveAs = useCallback(() => {
        const currentName = tab.viewName || ''
        const suggested = currentName ? currentName.replace(/\s*\(default\)\s*$/i, '') : ''
        const name = prompt('Save view as…', suggested)
        if (!name) return
        const exists = views.some(v => v.name === name && name !== tab.viewName)
        if (exists && !window.confirm(`View "${name}" already exists. Overwrite?`)) return
        const id = toast.loading(`Saving "${name}"…`)
        saveView.mutate(
            { server: tab.server, cube: tab.cube, name, ...buildSavePayload() },
            {
                onSuccess: () => {
                    setMdxDirty(false)
                    toast.success(`Saved "${name}"`, { id })
                    openTab({
                        id:       viewTabId(tab.server, tab.cube, name),
                        type:     'cubeview',
                        label:    `⊞ ${tab.cube} / ${name}`,
                        server:   tab.server,
                        cube:     tab.cube,
                        viewName: name,
                    })
                },
                onError: e => toast.error(e.message, { id }),
            }
        )
    }, [buildSavePayload, tab.server, tab.cube, tab.viewName, openTab, views, saveView, setMdxDirty])

    const handleSetDefault = useCallback(() => {
        if (!window.confirm(`Overwrite the default view for [${tab.cube}]?\n\nThis will save the current layout as "Default".`)) return
        const id = toast.loading('Setting as default…')
        saveView.mutate(
            { server: tab.server, cube: tab.cube, name: 'Default', ...buildSavePayload() },
            {
                onSuccess: () => {
                    setDefault.mutate(
                        { server: tab.server, cube: tab.cube, name: 'Default' },
                        {
                            onSuccess: () => { toast.success('Default view saved', { id }) },
                            onError:   e => toast.error(e.message, { id }),
                        }
                    )
                },
                onError: e => toast.error(e.message, { id }),
            }
        )
    }, [tab.server, tab.cube, buildSavePayload, saveView, setDefault])

    return {
        showSaveMenu, setShowSaveMenu,
        saveConflict, setSaveConflict,
        conflictDiff, setConflictDiff,
        dismissedId, setDismissedId,
        openConflict, checkBeforeSave,
        buildSavePayload, executeSave,
        handleSave, handleSaveAs, handleSaveAsNative, handleSetDefault,
        saveView, setDefault,
    }
}
