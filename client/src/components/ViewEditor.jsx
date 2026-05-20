'use client'
import { useState, useRef, useCallback, useMemo } from 'react'
import MonacoEditor from '@monaco-editor/react'
import { AgGridReact } from 'ag-grid-react'
import { AllCommunityModule, ModuleRegistry, themeBalham, colorSchemeDark, colorSchemeLight } from 'ag-grid-community'
import { useStore } from '@/store'
import { useView, useExecuteView, useSaveView } from '@/hooks/useApi'
import { toast } from 'sonner'
import { Play, Save, Loader2, ChevronRight, Table2 } from 'lucide-react'
import { cn } from '@/lib/utils'

ModuleRegistry.registerModules([AllCommunityModule])

// ── Parse TM1 cellset into a displayable grid ─────────────────────────────────

function parseCellset(data) {
    if (!data?.Axes?.length) return null
    const axes   = data.Axes
    const colAx  = axes.find(a => a.Ordinal === 0)
    const rowAx  = axes.find(a => a.Ordinal === 1)
    if (!colAx || !rowAx) return null

    const colTuples = colAx.Tuples ?? []
    const rowTuples = rowAx.Tuples ?? []
    const cells     = data.Cells ?? []

    const label = (t) => (t.Members ?? []).map(m => m.Name).join(' / ')

    const numCols = colTuples.length
    const numRows = rowTuples.length

    const cellMap = {}
    cells.forEach(c => { cellMap[c.Ordinal] = c })

    const grid = []
    for (let r = 0; r < numRows; r++) {
        const row = []
        for (let c = 0; c < numCols; c++) {
            const cell = cellMap[r * numCols + c]
            row.push(cell ? (cell.FormattedValue ?? cell.Value ?? '') : '')
        }
        grid.push(row)
    }

    return { cols: colTuples.map(label), rows: rowTuples.map(label), grid }
}

// ── AG Grid themes ────────────────────────────────────────────────────────────

const lightTheme = themeBalham.withPart(colorSchemeLight).withParams({ fontSize: 12, rowHeight: 24, headerHeight: 28 })
const darkTheme  = themeBalham.withPart(colorSchemeDark).withParams({ fontSize: 12, rowHeight: 24, headerHeight: 28 })

// ── Data grid ─────────────────────────────────────────────────────────────────

function DataGrid({ result, dark }) {
    const parsed = useMemo(() => result ? parseCellset(result) : null, [result])

    const { colDefs, rowData } = useMemo(() => {
        if (!parsed) return { colDefs: [], rowData: [] }
        const { cols, rows, grid } = parsed
        const colDefs = [
            {
                field: '__row__',
                headerName: '',
                pinned: 'left',
                width: 180,
                minWidth: 80,
                resizable: true,
                cellStyle: { fontWeight: 600 },
            },
            ...cols.map((c, i) => ({
                field: `c${i}`,
                headerName: c,
                width: 110,
                minWidth: 60,
                resizable: true,
                type: 'numericColumn',
                cellStyle: params => params.value === '' || params.value == null ? { color: '#888' } : {},
                valueFormatter: params => (params.value === '' || params.value == null) ? '—' : String(params.value),
            })),
        ]
        const rowData = grid.map((row, ri) => {
            const obj = { __row__: rows[ri] }
            row.forEach((v, ci) => { obj[`c${ci}`] = v })
            return obj
        })
        return { colDefs, rowData }
    }, [parsed])

    if (!result) {
        return (
            <div className="flex-1 flex items-center justify-center text-muted-foreground text-sm select-none">
                <div className="text-center">
                    <Table2 size={32} className="mx-auto mb-2 opacity-30" />
                    <p>Press Execute to run the view</p>
                </div>
            </div>
        )
    }

    if (!parsed || parsed.grid.length === 0) {
        return <div className="flex-1 flex items-center justify-center text-muted-foreground text-sm">No data returned</div>
    }

    return (
        <div className="flex-1 min-h-0">
            <AgGridReact
                theme={dark ? darkTheme : lightTheme}
                columnDefs={colDefs}
                rowData={rowData}
                suppressMovableColumns
                enableCellTextSelection
                defaultColDef={{ sortable: true, filter: false }}
            />
        </div>
    )
}

// ── ViewEditor ────────────────────────────────────────────────────────────────

export default function ViewEditor({ tab }) {
    const { dark, markTabSaved, updateTabContent } = useStore()
    const { data: viewDef, isLoading: defLoading } = useView(tab.server, tab.cube, tab.viewName)
    const executeView = useExecuteView()
    const saveView    = useSaveView()

    const [result, setResult]   = useState(null)
    const [mdxDirty, setMdxDirty] = useState(false)
    const editorRef = useRef(null)

    const isMDX    = viewDef?.['@odata.type']?.includes('MDXView') ?? false
    const mdxValue = tab.content ?? viewDef?.MDX ?? ''

    const handleExecute = useCallback(() => {
        const id = toast.loading('Executing view…')
        executeView.mutate(
            { server: tab.server, cube: tab.cube, view: tab.viewName },
            {
                onSuccess: (data) => { setResult(data); toast.success('Done', { id }) },
                onError:   (e)    => toast.error(e.message, { id }),
            }
        )
    }, [tab.server, tab.cube, tab.viewName])

    const handleSave = useCallback(() => {
        const mdx = editorRef.current?.getValue() ?? mdxValue
        const id  = toast.loading('Saving view…')
        saveView.mutate(
            { server: tab.server, cube: tab.cube, name: tab.viewName, mdx },
            {
                onSuccess: () => { setMdxDirty(false); markTabSaved(tab.id); toast.success('View saved', { id }) },
                onError:   (e) => toast.error(e.message, { id }),
            }
        )
    }, [tab.server, tab.cube, tab.viewName, mdxValue])

    const executing = executeView.isPending
    const saving    = saveView.isPending

    return (
        <div className="flex flex-col h-full min-h-0">
            {/* Toolbar */}
            <div className="flex items-center gap-2 px-3 py-1.5 border-b border-border shrink-0 bg-muted/30">
                <span className="text-xs text-muted-foreground font-mono truncate flex items-center gap-1">
                    <span className="text-foreground">{tab.cube}</span>
                    <ChevronRight size={12} className="shrink-0" />
                    <span className="text-foreground">{tab.viewName}</span>
                </span>
                {defLoading
                    ? <Loader2 size={12} className="animate-spin text-muted-foreground ml-1" />
                    : <span className={cn('text-[10px] px-1.5 py-0.5 rounded font-mono border ml-1',
                        isMDX
                            ? 'border-blue-500/40 text-blue-400 bg-blue-500/10'
                            : 'border-border text-muted-foreground bg-muted'
                      )}>
                        {isMDX ? 'MDX' : 'Native'}
                      </span>
                }
                <div className="flex-1" />
                {isMDX && (
                    <button
                        onClick={handleSave}
                        disabled={saving || !mdxDirty}
                        className={cn(
                            'flex items-center gap-1 px-2 py-1 rounded text-xs border transition-colors',
                            mdxDirty
                                ? 'bg-primary text-primary-foreground border-primary hover:bg-primary/90'
                                : 'text-muted-foreground border-border hover:bg-muted'
                        )}
                    >
                        {saving ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />}
                        Save
                    </button>
                )}
                <button
                    onClick={handleExecute}
                    disabled={executing}
                    className="flex items-center gap-1 px-2 py-1 rounded text-xs bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
                >
                    {executing ? <Loader2 size={12} className="animate-spin" /> : <Play size={12} />}
                    Execute
                </button>
            </div>

            {/* Body */}
            <div className="flex flex-1 min-h-0">
                {isMDX && (
                    <div className="w-80 shrink-0 border-r border-border flex flex-col min-h-0">
                        <div className="px-3 py-1 border-b border-border text-[10px] text-muted-foreground uppercase tracking-wider font-semibold">
                            MDX Definition
                        </div>
                        {defLoading ? (
                            <div className="flex-1 flex items-center justify-center">
                                <Loader2 size={16} className="animate-spin text-muted-foreground" />
                            </div>
                        ) : (
                            <MonacoEditor
                                height="100%"
                                language="plaintext"
                                value={mdxValue}
                                theme={dark ? 'vs-dark' : 'vs'}
                                onChange={v => { updateTabContent(tab.id, v); setMdxDirty(true) }}
                                onMount={(editor, monaco) => {
                                    editorRef.current = editor
                                    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, handleSave)
                                    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, handleExecute)
                                }}
                                options={{
                                    fontSize: 12,
                                    minimap: { enabled: false },
                                    wordWrap: 'on',
                                    scrollBeyondLastLine: false,
                                    lineNumbers: 'off',
                                    folding: false,
                                }}
                            />
                        )}
                    </div>
                )}

                <DataGrid result={result} dark={dark} />
            </div>
        </div>
    )
}
