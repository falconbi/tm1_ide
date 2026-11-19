import { useEffect, useRef, useCallback } from 'react'
import MonacoEditor from '@monaco-editor/react'
import { Locate } from 'lucide-react'
import { useStore } from '@/store'
import { useRules } from '@/hooks/useApi'
import { registerTM1Theme } from '@/lib/tm1-functions'
import { loadSettings } from '@/lib/formatters/settings.js'
import { getFunctionRef } from '@/lib/tm1-snippets.js'
import SnippetPanel from '@/components/SnippetPanel'
import ObjectHistoryPanel from '@/components/ObjectHistoryPanel'
import { ConflictBanner, ConflictSaveWarning } from '@/components/ConflictBanner'
import DiffViewerModal from '@/components/DiffViewerModal'
import RuleLensPanel from '@/components/RuleLensPanel'
import CubeDataSources from '@/components/CubeDataSources'
import HelpPanel from '@/components/HelpPanel'
import LineagePanel from '@/components/rules-editor/lineage/LineagePanel'
import CellTracePanel from '@/components/rules-editor/trace/CellTracePanel'
import RulesToolbar from '@/components/rules-editor/RulesToolbar'
import IssuesList from '@/components/rules-editor/IssuesList'
import useRulesPanels from '@/components/rules-editor/hooks/useRulesPanels'
import useRulesMonaco from '@/components/rules-editor/hooks/useRulesMonaco'
import useRulesCheck from '@/components/rules-editor/hooks/useRulesCheck'
import useRulesFormat from '@/components/rules-editor/hooks/useRulesFormat'
import useRulesSave from '@/components/rules-editor/hooks/useRulesSave'
import { rulesTabId, processTabId } from '@/lib/tab-ids'

export default function RulesEditor({ tab, onCursor }) {
  const { initTabContent, updateTabContent, openTab, openTabToSide, server, serverVersion, dark, themeVersion, setFormatSettingsOpen, setRevealTarget, markTabSaved, bumpRulesVersion } = useStore()
  const { data, isLoading } = useRules(tab.server, tab.cube)
  const editorRef = useRef(null)
  const monacoRef = useRef(null)

  const {
    openConflict, dismissedId, setDismissedId,
    saveConflict, setSaveConflict, conflictDiff, setConflictDiff,
    doSave, handleSave, saving,
  } = useRulesSave({ tab, editorRef, markTabSaved, bumpRulesVersion })

  const {
    showLineage, setShowLineage, showRuleLens, setShowRuleLens,
    ruleLensGrouped, setRuleLensGrouped, lineageMode, setLineageMode,
    showSnippets, setShowSnippets, showHelp, setShowHelp,
    showTrace, setShowTrace, showHistory, setShowHistory, cubeDims,
  } = useRulesPanels({ tab })

  const content = tab.content ?? data?.rules ?? ''

  useEffect(() => {
    if (data?.rules != null && !tab.dirty) {
      initTabContent(tab.id, data.rules)
    }
  }, [data])

  const { runCheck, checking, checkResult, checkErrors, setCheckErrors } =
    useRulesCheck({ tab, content, serverVersion, editorRef, monacoRef })

  const {
    formatPopupRef, showFormatPopup, setShowFormatPopup,
    formatStruct, setFormatStruct, runFormat, canUndoFormat, undoFormat,
  } = useRulesFormat({ editorRef })

  const {
    showMinimap, handleMount, undo, redo,
    regionsCollapsed, toggleRegions, showRegionMenu, regionList, goToRegion, toggleRegionMenu,
    insertSnippet, toggleMinimap,
  } = useRulesMonaco({
    tab, server, serverVersion, dark, themeVersion, onCursor, onSave: handleSave,
    editorRef, monacoRef, formatPopupRef, showFormatPopup, setShowFormatPopup,
  })

  // Contextual drill-ins (Lineage, Data Sources) open beside the rules you are reading.
  const openCube = useCallback((cube, openHere) => {
    const t = { id: rulesTabId(tab.server, cube), type: 'rules', label: cube, server: tab.server, cube, content: null }
    if (openHere) openTab(t); else openTabToSide(t)
  }, [tab.server, openTab, openTabToSide])

  const openProcess = useCallback((name, openHere) => {
    const t = { id: processTabId(tab.server, name), type: 'process', label: name, server: tab.server, name, content: null }
    if (openHere) openTab(t); else openTabToSide(t)
  }, [tab.server, openTab, openTabToSide])

  const openCubeMap = useCallback(() => {
    openTab({ id: `cubemap:${tab.server}`, type: 'cubemap', label: 'Cube Map', server: tab.server, focusCube: tab.cube, focusAt: Date.now() })
  }, [tab.server, tab.cube])

  // Transaction log for a rule-lens measure (other dimensions left unfiltered).
  const openTransactionLog = useCallback((elements, dims, label) => {
    openTabToSide({
      id: `txlog:${tab.server}:${tab.cube}:${Date.now()}`,
      type: 'transactionlog',
      label: `Log — ${tab.cube}${label ? ` · ${label}` : ''}`,
      server: tab.server, cube: tab.cube, cubeDims: dims, elements,
    }, { noSplit: true })
  }, [tab.server, tab.cube, openTabToSide])

  if (isLoading && tab.content === null) {
    return <div className="flex-1 flex items-center justify-center text-muted-foreground text-sm">Loading rules…</div>
  }

  return (
    <div className="flex flex-col h-full min-h-0 overflow-hidden">
      <ConflictBanner conflict={openConflict?.id !== dismissedId ? openConflict : null} onDismiss={() => setDismissedId(openConflict?.id)} />
      <ConflictSaveWarning
        conflict={saveConflict}
        onSaveAnyway={() => { setSaveConflict(null); doSave() }}
        onCancel={() => setSaveConflict(null)}
        onShowDiff={() => {
          setConflictDiff({
            object_type: 'rules',
            object_name: tab.cube,
            timestamp:   saveConflict.timestamp,
            action:      'CONFLICT',
            session_name: null,
            before_state: saveConflict.after_state ?? { text: data?.rules ?? '' },
            after_state:  { text: editorRef.current?.getValue() ?? '' },
          })
        }}
      />
      {conflictDiff && <DiffViewerModal entry={conflictDiff} onClose={() => setConflictDiff(null)} />}
      <div className="relative z-0 flex items-center gap-1.5 px-3 py-1 border-b border-border bg-muted/30 shrink-0">
        <span className="text-xs font-mono font-semibold text-foreground">{tab.cube}</span>
        <button
          onClick={() => setRevealTarget({ type: 'rules', server: tab.server, cube: tab.cube })}
          className="flex items-center text-amber-400 hover:text-amber-300 transition-colors"
          title="Show in tree"
        >
          <Locate size={11} />
        </button>
        <span className="text-xs text-muted-foreground">Rules</span>
      </div>
      <div className="relative z-10 flex flex-1 min-h-0 overflow-hidden">
      <div className="flex-1 min-w-0 overflow-hidden flex flex-col">
        <CubeDataSources server={tab.server} cube={tab.cube} onOpenCube={openCube} onOpenProcess={openProcess} onOpenMap={openCubeMap} />
        <div className="relative flex-1 min-h-0 overflow-hidden">
        <RulesToolbar
          dirty={tab.dirty}
          saving={saving}
          onSave={handleSave}
          onUndo={undo}
          onRedo={redo}
          checking={checking}
          checkResult={checkResult}
          onCheck={runCheck}
          showFormatPopup={showFormatPopup}
          onToggleFormatPopup={() => setShowFormatPopup(v => !v)}
          formatPopupRef={formatPopupRef}
          formatStruct={formatStruct}
          onSelectFormatStruct={setFormatStruct}
          runFormat={runFormat}
          canUndoFormat={canUndoFormat}
          onUndoFormat={undoFormat}
          onOpenFormatSettings={() => { setShowFormatPopup(false); setFormatSettingsOpen(true) }}
          showRegionMenu={showRegionMenu}
          onToggleRegionMenu={toggleRegionMenu}
          regionList={regionList}
          onGoToRegion={goToRegion}
          regionsCollapsed={regionsCollapsed}
          onToggleRegions={toggleRegions}
          showSnippets={showSnippets}
          onToggleSnippets={() => setShowSnippets(s => !s)}
          showTrace={showTrace}
          onToggleTrace={() => setShowTrace(s => !s)}
          showMinimap={showMinimap}
          onToggleMinimap={toggleMinimap}
          showLineage={showLineage}
          onToggleLineage={() => setShowLineage(s => !s)}
          showRuleLens={showRuleLens}
          onToggleRuleLens={() => setShowRuleLens(s => !s)}
          showHistory={showHistory}
          onToggleHistory={() => setShowHistory(v => !v)}
          onShowHelp={() => setShowHelp(true)}
        />
        <HelpPanel open={showHelp} onClose={() => setShowHelp(false)} area="rules" />
        <MonacoEditor
          height="100%"
          language="tm1rules"
          value={content}
          theme="tm1-custom"
          beforeMount={monaco => registerTM1Theme(monaco, dark)}
          onChange={v => updateTabContent(tab.id, v)}
          onMount={handleMount}
          options={{ padding: { top: 48, bottom: 12 }, fontFamily: loadSettings().editor?.fontFamily ?? undefined, fontSize: loadSettings().editor?.fontSize ?? undefined, lineHeight: loadSettings().editor?.lineHeight ?? undefined, minimap: { enabled: showMinimap }, wordWrap: 'on', scrollBeyondLastLine: false, folding: true, foldingStrategy: 'auto', glyphMargin: true, wordBasedSuggestions: 'off' }}
        />
        {showHistory && (
          <ObjectHistoryPanel
            server={tab.server}
            objectType="rules"
            objectName={tab.cube}
            onClose={() => setShowHistory(false)}
          />
        )}
        </div>{/* end relative flex-1 editor wrapper */}
        <IssuesList
          errors={checkErrors}
          onClear={() => setCheckErrors([])}
          onJump={line => {
            editorRef.current?.revealLineInCenter(line)
            editorRef.current?.setPosition({ lineNumber: line, column: 1 })
            editorRef.current?.focus()
          }}
        />
      </div>
      {showSnippets && (
        <div className="w-72 shrink-0 border-l border-border flex flex-col bg-sidebar overflow-hidden">
          <SnippetPanel snippets={getFunctionRef('rules')} language="rules" onInsert={insertSnippet} />
        </div>
      )}
      {showTrace && (
        <CellTracePanel
          tabId={tab.id}
          server={tab.server}
          cube={tab.cube}
          cubeDims={cubeDims}
          onClose={() => setShowTrace(false)}
        />
      )}
      {showLineage && (
        <LineagePanel server={tab.server} cube={tab.cube} onOpen={openCube} mode={lineageMode} setMode={setLineageMode} />
      )}
      {showRuleLens && (
        <RuleLensPanel server={tab.server} cube={tab.cube} onOpenCube={openCube} onOpenMap={openCubeMap} onClose={() => setShowRuleLens(false)} grouped={ruleLensGrouped} onToggleGrouped={setRuleLensGrouped} onOpenLog={openTransactionLog} />
      )}
      </div>
    </div>
  )
}
