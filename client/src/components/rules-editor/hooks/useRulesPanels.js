import { useEffect, useState } from 'react'
import { useCubeDimensions } from '@/hooks/useApi'
import { getRulesSession, saveRulesSession } from '@/lib/rules-session'

// Side panels, lineage mode and Rule Lens grouping, plus the per-tab rules
// session that keeps them open across a split remount.
export default function useRulesPanels({ tab }) {
  const savedUi = getRulesSession(tab.id)
  const [showLineage, setShowLineage] = useState(savedUi?.showLineage ?? false)
  const [showRuleLens, setShowRuleLens] = useState(savedUi?.showRuleLens ?? false)
  const [ruleLensGrouped, setRuleLensGrouped] = useState(savedUi?.ruleLensGrouped ?? false)
  const [lineageMode, setLineageMode] = useState(savedUi?.lineageMode ?? 'sources')
  const [showSnippets, setShowSnippets] = useState(savedUi?.showSnippets ?? false)
  const [showHelp, setShowHelp] = useState(false)
  const [showTrace, setShowTrace] = useState(savedUi?.showTrace ?? false)
  const [showHistory, setShowHistory] = useState(savedUi?.showHistory ?? false)
  const { data: cubeDimsData } = useCubeDimensions(showTrace ? tab.server : null, showTrace ? tab.cube : null)
  const cubeDims = cubeDimsData ?? null

  // Keep side-panel state for this tab when a lineage cube opens another rules tab.
  // Saved on change (not just unmount): a split remounts this editor immediately.
  useEffect(() => {
    saveRulesSession(tab.id, { showLineage, lineageMode, showSnippets, showHistory, showRuleLens, ruleLensGrouped, showTrace })
  }, [tab.id, showLineage, lineageMode, showSnippets, showHistory, showRuleLens, ruleLensGrouped, showTrace])

  return {
    showLineage, setShowLineage,
    showRuleLens, setShowRuleLens,
    ruleLensGrouped, setRuleLensGrouped,
    lineageMode, setLineageMode,
    showSnippets, setShowSnippets,
    showHelp, setShowHelp,
    showTrace, setShowTrace,
    showHistory, setShowHistory,
    cubeDims,
  }
}
