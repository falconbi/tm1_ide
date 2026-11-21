import { useState } from 'react'
import { useStore } from '@/store'
import { Locate } from 'lucide-react'
import ProcessEditor from '@/components/process-editor/ProcessEditor'
import SQLEditor from '@/components/SQLEditor'
import SubsetEditor from '@/components/SubsetEditor'
import DimensionEditor from '@/components/dimension-editor/DimensionEditor'
import ViewEditor from '@/components/view-editor/ViewEditor'
import ChoreEditor from '@/components/ChoreEditor'
import GuidedMDXBuilder from '@/components/GuidedMDXBuilder'
import CubeEditor from '@/components/CubeEditor'
import TransactionLogPanel from '@/components/TransactionLogPanel'
import DiffTab from '@/components/DiffTab'
import SessionReportTab from '@/components/SessionReportTab'
import CubeMapEditor from '@/components/cubemap-editor/CubeMapEditor'
import LensEditor from '@/components/LensEditor'
import RulesEditor from '@/components/rules-editor/RulesEditor'
import DeployTab from '@/components/DeployTab'
import { getRevealTarget } from '@/lib/reveal-target'

// ── Dispatcher ────────────────────────────────────────────────────────────────

export default function EditorPane({ groupId }) {
  const { tabs, groups, setRevealTarget, setActiveGroup } = useStore()
  const group = groups.find(g => g.id === groupId)
  const tab = tabs.find(t => t.id === group?.activeTabId)
  const [cursor, setCursorLocal] = useState({ line: 1, col: 1 })

  const handleCursor = (pos) => setCursorLocal(pos)

  if (!tab) {
    return (
      <div className="flex-1 flex flex-col min-h-0" onClick={() => setActiveGroup(groupId)}>
        <div className="flex-1 flex items-center justify-center text-muted-foreground text-sm select-none">
          Open an object from the explorer to start editing.
        </div>
        <div className="h-5" />
      </div>
    )
  }

  return (
    <div className="flex-1 flex flex-col min-h-0" onClick={() => setActiveGroup(groupId)}>
      <div className="flex-1 min-h-0 overflow-hidden">
        {tab.type === 'rules'      && <RulesEditor    key={tab.id} tab={tab} onCursor={handleCursor} />}
        {tab.type === 'process'    && <ProcessEditor  key={tab.id} tab={tab} />}
        {tab.type === 'subset'     && <SubsetEditor   key={tab.id} tab={tab} />}
        {tab.type === 'dimension'  && <DimensionEditor key={tab.id} tab={tab} />}
        {(tab.type === 'view' || tab.type === 'cubeview') && <ViewEditor key={tab.id} tab={tab} />}
        {tab.type === 'chore'      && <ChoreEditor    key={tab.id} tab={tab} />}
        {tab.type === 'guidedmdxview'   && <GuidedMDXBuilder  key={tab.id} tab={tab} />}
        {tab.type === 'sql'             && <SQLEditor          key={tab.id} tab={tab} />}
        {tab.type === 'cubeeditor'      && <CubeEditor         key={tab.id} tab={tab} />}
        {tab.type === 'diff'            && <DiffTab            key={tab.id} tab={tab} />}
        {tab.type === 'cubemap'         && <CubeMapEditor      key={tab.id} tab={tab} />}
        {tab.type === 'session-report'  && <SessionReportTab   key={tab.id} tab={tab} />}
        {tab.type === 'lens'           && <LensEditor        key={tab.id} tab={tab} />}
        {tab.type === 'deploy'         && <DeployTab          key={tab.id} />}
        {tab.type === 'transactionlog'  && (
          <div key={tab.id} className="flex h-full min-h-0 bg-sidebar">
            <TransactionLogPanel
              server={tab.server}
              cube={tab.cube}
              cubeDims={tab.cubeDims ?? []}
              tupleFilter={tab.elements?.length ? tab.elements : null}
              onClearFilter={null}
              onClose={null}
              fill
            />
          </div>
        )}
      </div>
      <div className="flex items-center px-3 py-0.5 bg-muted border-t border-border text-xs text-muted-foreground shrink-0">
        <span>Ln {cursor.line}, Col {cursor.col}</span>
        <span className="ml-4">
          {tab.type === 'rules' ? 'TM1 Rules' : tab.type === 'subset' ? 'Subset' : tab.type === 'dimension' ? 'Dimension' : tab.type === 'view' || tab.type === 'cubeview' ? 'View' : tab.type === 'chore' ? 'Chore' : tab.type === 'cubeeditor' ? 'Cube' : tab.type === 'deploy' ? 'Deploy' : 'TM1 TI'}
        </span>
        {getRevealTarget(tab) && (
          <button
            onClick={() => setRevealTarget(getRevealTarget(tab))}
            className="ml-auto flex items-center gap-1 text-amber-400 hover:text-amber-300 transition-colors"
            title="Show in tree"
          >
            <Locate size={11} /> Show in tree
          </button>
        )}
      </div>
    </div>
  )
}
