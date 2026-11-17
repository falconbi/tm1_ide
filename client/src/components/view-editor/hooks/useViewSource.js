import { useState } from 'react'
import { useViewSourceUsage } from '@/hooks/useApi'

// A view that is the source of a TI process is previewed from the process's
// records first; "open full" overrides that. No effects.
export default function useViewSource({ tab }) {
    const { data: sourceUsage, isLoading: loadingSourceUsage } = useViewSourceUsage(tab.server, tab.cube, tab.viewName)
    const [sourceOverride, setSourceOverride] = useState(false)
    const sourceProcesses = sourceUsage?.processes ?? []
    const sourceMode = !!tab.viewName && sourceProcesses.length > 0 && !sourceOverride
    return { sourceOverride, setSourceOverride, sourceProcesses, loadingSourceUsage, sourceMode }
}
