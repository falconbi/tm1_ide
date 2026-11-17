import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

// The flat fallback grid: mode, quick filter, freeze row, persisted widths and
// the AG Grid appearance refreshes.
export default function useFlatGrid({ tab, app, baseFlatColDefs, rowData }) {
    const flatGridRef = useRef(null)
    const flatRootRef = useRef(null)
    const flatStorageKey = tab.server && tab.cube ? `ve-flat::${tab.server}::${tab.cube}::${tab.viewName || 'adhoc'}` : undefined
    const [flatQuickFilter, setFlatQuickFilter] = useState('')
    const [flatFreezeTop, setFlatFreezeTop] = useState(false)
    const [flatMode, setFlatMode] = useState(false)
    const flatSavedWidthsRef = useRef(null)
    if (flatSavedWidthsRef.current === null) {
        flatSavedWidthsRef.current = flatStorageKey
            ? (() => { try { return JSON.parse(localStorage.getItem(flatStorageKey) || '{}') } catch { return {} } })()
            : {}
    }
    const handleFlatSearch = useCallback((text) => {
        setFlatQuickFilter(text)
        if (text) setFlatFreezeTop(false)
    }, [])

    // Apply persisted widths to the flat fallback grid
    const colDefs = useMemo(() => {
        const savedWidths = flatStorageKey
            ? (() => { try { return JSON.parse(localStorage.getItem(flatStorageKey) || '{}') } catch { return {} } })()
            : {}
        return baseFlatColDefs.map(cd => {
            const saved = savedWidths[cd.field]
            return saved ? { ...cd, width: saved } : cd
        })
    }, [baseFlatColDefs, flatStorageKey])

    const persistFlatWidths = useCallback(() => {
        if (!flatStorageKey) return
        try { localStorage.setItem(flatStorageKey, JSON.stringify(flatSavedWidthsRef.current)) } catch { /* ignore */ }
    }, [flatStorageKey])

    const onFlatColumnResized = useCallback((e) => {
        if (!e.finished || !e.column) return
        flatSavedWidthsRef.current[e.column.getColId()] = e.column.getActualWidth()
        persistFlatWidths()
    }, [persistFlatWidths])

    const handleFlatResetWidths = useCallback(() => {
        flatSavedWidthsRef.current = {}
        if (flatStorageKey) { try { localStorage.removeItem(flatStorageKey) } catch { /* ignore */ } }
        flatGridRef.current?.api?.resetColumnWidths?.()
        flatGridRef.current?.api?.autoSizeAllColumns?.()
    }, [flatStorageKey])

    const handleFlatExportCSV = useCallback(() => {
        flatGridRef.current?.api?.exportDataAsCsv?.()
    }, [])

    // Freeze top — set via the grid API (not a React prop) to avoid AG Grid's
    // re-render crash (issue #10278 / AG-14590). setTimeout defers past the
    // "cannot draw rows while drawing" render stage.
    useEffect(() => {
        const api = flatGridRef.current?.api
        if (!api) return
        const t = setTimeout(() => {
            api.setGridOption('pinnedTopRowData', flatFreezeTop && rowData.length ? [{ ...rowData[0] }] : null)
        }, 0)
        return () => clearTimeout(t)
    }, [flatFreezeTop, rowData])

    // Re-apply visual appearance settings (zebra, row height, font size) — AG
    // Grid doesn't redraw rows when these change.
    useEffect(() => {
        const api = flatGridRef.current?.api
        if (!api) return
        const t = setTimeout(() => {
            api.redrawRows()
            api.refreshHeader?.()
        }, 0)
        return () => clearTimeout(t)
    }, [app.refreshKey])

    return {
        flatGridRef, flatRootRef, flatStorageKey,
        flatQuickFilter, flatFreezeTop, setFlatFreezeTop,
        flatMode, setFlatMode, flatSavedWidthsRef,
        handleFlatSearch, colDefs, onFlatColumnResized,
        handleFlatResetWidths, handleFlatExportCSV,
    }
}
