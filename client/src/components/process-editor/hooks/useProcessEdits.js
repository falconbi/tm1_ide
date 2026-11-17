import { useCallback, useEffect, useState } from 'react'
import { useStore } from '@/store'
import { sectionsFromEdits } from '@/lib/process-editor/sections'
import { scanVariables } from '@/lib/ti-interpreter'

// The editor's local edits: the four section bodies, the parameter and
// datasource edits, the active section, and the variable list for the watch
// dropdown. `data` is the saved process from useProcess.
export default function useProcessEdits({ tab, data }) {
  const { initTabContent, patchTab } = useStore()

  // Local edits keyed by section; null = no changes
  const [edits, setEdits]           = useState({})
  const [paramEdits, setParamEdits] = useState(null)
  const [dsEdits, setDsEdits]       = useState(null)
  const [activeSection, setActiveSection] = useState('PrologProcedure')

  useEffect(() => {
    if (data) { initTabContent(tab.id, data); setParamEdits(null); setDsEdits(null) }
  }, [data])

  const markDirty = useCallback(() => {
    const current = useStore.getState().tabs.find(t => t.id === tab.id)
    if (current && !current.dirty) patchTab(tab.id, { dirty: true })
  }, [tab.id, patchTab])

  // Build sorted variable list for watch dropdown
  const availableVars = (() => {
    const sections = sectionsFromEdits(edits, data)
    const params = paramEdits ?? data?.Parameters ?? []
    return scanVariables(sections, params, data?.Variables)
  })()

  const value = edits[activeSection] ?? data?.[activeSection] ?? ''

  return {
    edits, setEdits,
    paramEdits, setParamEdits,
    dsEdits, setDsEdits,
    activeSection, setActiveSection,
    markDirty, availableVars, value,
  }
}
