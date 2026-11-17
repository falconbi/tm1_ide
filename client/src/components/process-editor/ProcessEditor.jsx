import { useState, useRef } from 'react'
import MonacoEditor from '@monaco-editor/react'
import { useStore } from '@/store'
import { useProcess } from '@/hooks/useApi'
import { registerTM1Theme } from '@/lib/tm1-functions'
import { cn } from '@/lib/utils'
import { getFunctionRef } from '@/lib/tm1-snippets.js'
import { loadSettings } from '@/lib/formatters/settings.js'
import HelpPanel from '@/components/HelpPanel'
import ObjectHistoryPanel from '@/components/ObjectHistoryPanel'
import SnippetPanel from '@/components/SnippetPanel'
import { ConflictBanner, ConflictSaveWarning } from '@/components/ConflictBanner'
import DiffViewerModal from '@/components/DiffViewerModal'
import ParamsPanel from '@/components/process-editor/panels/ParamsPanel'
import DatasourcePanel from '@/components/process-editor/panels/DatasourcePanel'
import DatasourcePreview from '@/components/process-editor/panels/DatasourcePreview'
import CollapsibleSection from '@/components/process-editor/panels/CollapsibleSection'
import VariablesPanel from '@/components/process-editor/panels/VariablesPanel'
import RunDialog from '@/components/process-editor/dialogs/RunDialog'
import SaveAsDialog from '@/components/process-editor/dialogs/SaveAsDialog'
import DebugPanel from '@/components/process-editor/DebugPanel'
import ProcessToolbar from '@/components/process-editor/ProcessToolbar'
import RunOutputPanel from '@/components/process-editor/RunOutputPanel'
import useProcessEdits from '@/components/process-editor/hooks/useProcessEdits'
import useProcessCheck from '@/components/process-editor/hooks/useProcessCheck'
import useProcessRun from '@/components/process-editor/hooks/useProcessRun'
import useProcessDebug from '@/components/process-editor/hooks/useProcessDebug'
import useProcessMonaco from '@/components/process-editor/hooks/useProcessMonaco'
import useProcessSave from '@/components/process-editor/hooks/useProcessSave'
import { CheckCircle2, XCircle, Search, AlertTriangle, Locate, HelpCircle } from 'lucide-react'

export default function ProcessEditor({ tab }) {
  const { server, serverVersion, dark, themeVersion, setRevealTarget } = useStore()
  const { data, isLoading } = useProcess(tab.server, tab.name)

  // Shared with useProcessCheck so the check hook needs no order against Monaco.
  const editorRef = useRef(null)
  const monacoRef = useRef(null)
  const [showHelp, setShowHelp] = useState(false)
  const [showSnippets, setShowSnippets] = useState(false)
  const [showHistory, setShowHistory] = useState(false)

  const editsApi = useProcessEdits({ tab, data })
  const checkApi = useProcessCheck({
    serverVersion, data, edits: editsApi.edits, activeSection: editsApi.activeSection, editorRef, monacoRef,
  })
  const runApi = useProcessRun({ tab })
  const debugApi = useProcessDebug({
    tab, data, edits: editsApi.edits, paramEdits: editsApi.paramEdits,
    availableVars: editsApi.availableVars, setCheckResults: checkApi.setCheckResults,
    clearRunOutput: runApi.clearRunOutput,
  })
  const monacoApi = useProcessMonaco({
    tab, server, serverVersion, dark, themeVersion,
    activeSection: editsApi.activeSection, setActiveSection: editsApi.setActiveSection,
    breakpoints: debugApi.breakpoints, showDebug: debugApi.showDebug,
    toggleBreakpoint: debugApi.toggleBreakpoint, editorRef, monacoRef,
  })
  const saveApi = useProcessSave({
    tab, data, edits: editsApi.edits, paramEdits: editsApi.paramEdits, dsEdits: editsApi.dsEdits,
  })

  const toggleCheck = () => {
    debugApi.setShowDebug(false)
    setShowSnippets(false)
    if (checkApi.showCheck) checkApi.setShowCheck(false)
    else checkApi.handleCheck()
  }
  const toggleDebug = () => { debugApi.setShowDebug(d => !d); setShowSnippets(false) }
  const toggleSnippets = () => { setShowSnippets(s => !s); debugApi.setShowDebug(false) }

  if (isLoading && !data) {
    return <div className="flex-1 flex items-center justify-center text-muted-foreground text-sm">Loading process…</div>
  }

  return (
    <div className="flex flex-col h-full">
      <ConflictBanner conflict={saveApi.bannerConflict} onDismiss={saveApi.dismissBanner} />
      <ConflictSaveWarning
        conflict={saveApi.saveConflict}
        onSaveAnyway={saveApi.saveAnyway}
        onCancel={saveApi.cancelSaveConflict}
        onShowDiff={saveApi.showConflictDiff}
      />
      {saveApi.conflictDiff && <DiffViewerModal entry={saveApi.conflictDiff} onClose={saveApi.closeConflictDiff} />}
      {tab.name && (
        <div className="flex items-center gap-1.5 px-3 py-1 border-b border-border bg-muted/30 shrink-0">
          <span className="text-xs font-mono font-semibold text-foreground">{tab.name}</span>
          <button
            onClick={() => setRevealTarget({ type: 'process', server: tab.server, name: tab.name })}
            className="flex items-center text-amber-400 hover:text-amber-300 transition-colors"
            title="Show in tree"
          >
            <Locate size={11} />
          </button>
          <span className="text-xs text-muted-foreground">TI Process</span>
          <button
            onClick={() => setShowHelp(true)}
            className="ml-auto flex items-center gap-1 px-2 py-1 rounded text-xs border bg-background/80 border-border text-muted-foreground hover:text-foreground transition-colors"
            title="Help — TI Process Editor"
          >
            <HelpCircle size={11} />
          </button>
        </div>
      )}
      <HelpPanel open={showHelp} onClose={() => setShowHelp(false)} area="ti" />

      {/* ── Save As dialog ────────────────────────────────────────────── */}
      {saveApi.showSaveAs && (
        <SaveAsDialog
          sourceName={tab.name}
          onSave={saveApi.handleSaveAs}
          onClose={() => saveApi.setShowSaveAs(false)}
          isPending={saveApi.createPending || saveApi.saving}
        />
      )}

      {/* ── Run dialog ────────────────────────────────────────────────── */}
      {runApi.showRun && (
        <RunDialog
          params={data?.Parameters}
          onRun={runApi.handleRun}
          onClose={() => runApi.setShowRun(false)}
          isPending={runApi.running}
        />
      )}

      {/* ── Debug run dialog ──────────────────────────────────────────── */}
      {debugApi.showDebugRun && (
        <RunDialog
          title="Capture Run"
          params={editsApi.paramEdits ?? data?.Parameters}
          onRun={debugApi.handleDebugRun}
          onClose={() => debugApi.setShowDebugRun(false)}
          isPending={debugApi.isDebugging}
        />
      )}

      <ProcessToolbar
        tab={tab}
        activeSection={editsApi.activeSection}
        onSectionChange={editsApi.setActiveSection}
        edits={editsApi.edits}
        showHistory={showHistory}
        onToggleHistory={() => setShowHistory(v => !v)}
        onUndo={monacoApi.undo}
        onRedo={monacoApi.redo}
        draftName={saveApi.draftName}
        onDraftNameChange={saveApi.setDraftName}
        onCreateNew={saveApi.handleCreateNew}
        creating={saveApi.createPending || saveApi.saving}
        onSave={saveApi.handleSave}
        saveDisabled={!Object.keys(editsApi.edits).length && editsApi.paramEdits === null && editsApi.dsEdits === null}
        saving={saveApi.saving}
        showSaveMenu={saveApi.showSaveMenu}
        saveMenuRect={saveApi.saveMenuRect}
        onToggleSaveMenu={saveApi.toggleSaveMenu}
        onCloseSaveMenu={saveApi.closeSaveMenu}
        onSaveAs={saveApi.openSaveAs}
        hasData={!!data}
        onToggleCheck={toggleCheck}
        showCheck={checkApi.showCheck}
        onToggleDebug={toggleDebug}
        showDebug={debugApi.showDebug}
        onToggleSnippets={toggleSnippets}
        showSnippets={showSnippets}
        onRun={() => runApi.setShowRun(true)}
        showRegionMenu={monacoApi.showRegionMenu}
        regionRect={monacoApi.regionRect}
        regionList={monacoApi.regionList}
        onOpenRegionMenu={monacoApi.openRegionMenu}
        onGoToRegion={monacoApi.goToRegion}
        regionBtnRef={monacoApi.regionBtnRef}
        regionsCollapsed={monacoApi.regionsCollapsed}
        onToggleRegions={monacoApi.toggleRegions}
        onToggleMinimap={monacoApi.toggleMinimap}
        showMinimap={monacoApi.showMinimap}
      />

      {/* ── Collapsible metadata sections ─────────────────────────────── */}
      {data && (
        <CollapsibleSection
          label="Datasource"
          hint={(() => {
            const d = editsApi.dsEdits ?? data.DataSource
            const t = d?.Type ?? 'None'
            if (!d || t === 'None') return editsApi.dsEdits !== null ? 'None · unsaved' : 'None'
            const name = d.dataSourceNameForServer ?? d.dataSourceNameForClient ?? ''
            return `${t}${name ? '  ·  ' + name : ''}${editsApi.dsEdits !== null ? ' · unsaved' : ''}`
          })()}
        >
          <DatasourcePanel
            ds={editsApi.dsEdits ?? data.DataSource ?? { Type: 'None' }}
            server={tab.server}
            onChange={v => { editsApi.setDsEdits(v); editsApi.markDirty() }}
          />
        </CollapsibleSection>
      )}

      {data && ['ODBC', 'ASCII', 'TM1CubeView', 'TM1DimensionSubset'].includes((editsApi.dsEdits ?? data.DataSource)?.Type) && (
        <CollapsibleSection label="Datasource Preview" hint={(editsApi.dsEdits ?? data.DataSource)?.dataSourceNameForServer ?? ''}>
          <DatasourcePreview ds={editsApi.dsEdits ?? data.DataSource} server={tab.server} params={editsApi.paramEdits ?? data.Parameters} />
        </CollapsibleSection>
      )}

      {data?.Variables?.length > 0 && (
        <CollapsibleSection label="Variables" hint={`${data.Variables.length} column${data.Variables.length !== 1 ? 's' : ''}`}>
          <VariablesPanel variables={data.Variables} />
        </CollapsibleSection>
      )}

      {data && (
        <CollapsibleSection
          label="Parameters"
          hint={(() => {
            const list = editsApi.paramEdits ?? data.Parameters ?? []
            const base = `${list.length} parameter${list.length !== 1 ? 's' : ''}`
            return editsApi.paramEdits !== null ? base + ' · unsaved' : base
          })()}
        >
          <ParamsPanel
            params={editsApi.paramEdits ?? data.Parameters ?? []}
            onChange={v => { editsApi.setParamEdits(v); editsApi.markDirty() }}
          />
        </CollapsibleSection>
      )}

      {runApi.runOutput && (
        <RunOutputPanel
          runOutput={runApi.runOutput}
          onJumpToError={monacoApi.jumpToError}
          errorLogFilename={runApi.errorLogFilename}
          errorLogOpen={runApi.errorLogOpen}
          onErrorLogClick={runApi.errorLogOpen ? () => runApi.setErrorLogOpen(false) : runApi.loadErrorLog}
          logOpen={runApi.logOpen}
          onToggleLog={() => runApi.setLogOpen(o => !o)}
          logContent={runApi.logContent}
          errorLogLoading={runApi.errorLogLoading}
          errorLogContent={runApi.errorLogContent}
          onClose={runApi.resetRunOutput}
        />
      )}

      {/* ── Monaco editor ─────────────────────────────────────────────── */}
      <div className="flex flex-1 min-h-0 overflow-hidden">
        <div className="flex-1 min-h-0 min-w-0">
          <MonacoEditor
            key={editsApi.activeSection}
            height="100%"
            language="tm1ti"
            value={editsApi.value}
            theme="tm1-custom"
            beforeMount={monaco => registerTM1Theme(monaco, dark)}
            onChange={v => { editsApi.setEdits(e => ({ ...e, [editsApi.activeSection]: v })); editsApi.markDirty() }}
            onMount={monacoApi.handleMount}
            options={{
              padding: { top: 48, bottom: 12 },
              fontFamily: loadSettings().editor?.fontFamily ?? undefined,
              fontSize: loadSettings().editor?.fontSize ?? undefined,
              lineHeight: loadSettings().editor?.lineHeight ?? undefined,
              minimap: { enabled: monacoApi.showMinimap },
              wordWrap: 'on',
              scrollBeyondLastLine: false,
              glyphMargin: true,
              folding: true,
              foldingStrategy: 'auto',
              find: { seedSearchStringFromSelection: 'always', autoFindInSelection: 'never' },
              wordBasedSuggestions: 'off',
            }}
          />
          {showHistory && tab.name && (
            <ObjectHistoryPanel
              server={tab.server}
              objectType="process"
              objectName={tab.name}
              onClose={() => setShowHistory(false)}
            />
          )}
        </div>
        {showSnippets && (
          <div className="w-72 shrink-0 border-l border-border flex flex-col bg-sidebar overflow-hidden">
            <SnippetPanel snippets={getFunctionRef('ti')} language="ti" onInsert={monacoApi.insertSnippet} />
          </div>
        )}
        {debugApi.showDebug && (
            <DebugPanel
              watches={debugApi.watches}
              onWatchesChange={debugApi.setWatches}
              captureWhen={debugApi.captureWhen}
              onCaptureWhenChange={debugApi.setCaptureWhen}
              events={debugApi.debugEvents}
              isDebugging={debugApi.isDebugging}
              availableVars={editsApi.availableVars}
              onRun={debugApi.startDebugRun}
              onJumpTo={monacoApi.jumpToDebugLine}
            />
          )}
          {checkApi.showCheck && checkApi.checkResults && (
            <div className="w-80 shrink-0 border-l border-border flex flex-col bg-sidebar overflow-hidden">
              <div className="flex items-center justify-between px-3 py-2 border-b border-border shrink-0">
                <span className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                  <Search size={11} /> Issues
                </span>
                <span className="text-[10px] text-muted-foreground">
                  {checkApi.checkResults.length === 0
                    ? 'No issues'
                    : `${checkApi.checkResults.filter(r => r.severity === 'error').length} err / ${checkApi.checkResults.filter(r => r.severity === 'warning').length} warn`}
                </span>
              </div>
              <div className="flex-1 overflow-auto">
                {checkApi.checkResults.length === 0 ? (
                  <div className="px-3 py-3 text-xs text-muted-foreground italic flex items-center gap-1.5">
                    <CheckCircle2 size={12} className="text-green-500 shrink-0" />
                    All checks passed
                  </div>
                ) : (
                  <div className="py-1">
                    {checkApi.checkResults.map((r, i) => (
                      <div
                        key={i}
                        onClick={() => r.line && monacoApi.jumpToDebugLine(r.section, r.line)}
                        className={cn(
                          'flex items-start gap-2 px-3 py-1.5 text-xs border-b border-border/30 last:border-0 cursor-pointer hover:bg-muted/50',
                          r.severity === 'error' ? 'text-red-400' : 'text-amber-400'
                        )}
                      >
                        {r.severity === 'error'
                          ? <XCircle size={12} className="mt-0.5 shrink-0" />
                          : <AlertTriangle size={12} className="mt-0.5 shrink-0" />}
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5 mb-0.5">
                            <span className={cn(
                              'font-semibold uppercase text-[10px]',
                              r.section === 'Prolog' ? 'text-blue-400' :
                              r.section === 'Metadata' ? 'text-purple-400' :
                              r.section === 'Data' ? 'text-green-400' :
                              r.section === 'Epilog' ? 'text-orange-400' : ''
                            )}>{r.section}</span>
                            {r.line && <span className="text-muted-foreground text-[10px]">:{r.line}</span>}
                          </div>
                          <div className="text-foreground/80 text-[11px] leading-relaxed break-words">{r.message}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

    </div>
  )
}
