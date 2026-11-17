import { useMemo, useState } from 'react'
import { prefixOf } from '@/lib/cubemap-editor/filters.js'

const TRACE_KIND_DEFAULTS = { rule: true, feeder: true, read: true, write: true, dimwrite: true, call: true, dimuse: true }

// What the map draws: model scope, search, dimensions vs processes, which link
// kinds the trace follows, and the per-server prefs that outlive the tab.
export default function useCubemapFilters({ cubeDataAll, processDataAll, dimDataAll, prefs }) {
  const [search,         setSearch]         = useState('')
  const [showFeeders,    setShowFeeders]    = useState(prefs.showFeeders ?? true)
  const [showCalc,       setShowCalc]       = useState(prefs.showCalc ?? true)
  const [dimFilter,      setDimFilter]      = useState(null)
  const [traceDepth,     setTraceDepth]     = useState(prefs.traceDepth ?? 1)
  const [traceKinds,     setTraceKinds]     = useState({ ...TRACE_KIND_DEFAULTS, ...(prefs.traceKinds ?? {}) })
  const [dimSpotlight,   setDimSpotlight]   = useState('')
  const [showProcesses,  setShowProcesses]  = useState(prefs.showProcesses ?? true)
  const [allTI,          setAllTI]          = useState(prefs.allTI ?? false)
  const [showDims,       setShowDims]       = useState(prefs.showDims ?? true)
  const [showLensActions, setShowLensActions] = useState(prefs.showLensActions ?? true)
  const [scope,          setScope]          = useState(prefs.scope ?? '')

  // Prefix scope: WFP / LAB / SYS… — hides the other model instead of just clustering it.
  const prefixes = useMemo(() => [...new Set([
    ...Object.keys(cubeDataAll ?? {}), ...Object.keys(processDataAll ?? {}),
  ].map(prefixOf).filter(Boolean))].sort(), [cubeDataAll, processDataAll])

  const cubeData = useMemo(() => (!cubeDataAll ? cubeDataAll : !scope ? cubeDataAll : Object.fromEntries(Object.entries(cubeDataAll).filter(([n]) => prefixOf(n) === scope))), [cubeDataAll, scope])
  const processData = useMemo(() => (!scope ? processDataAll : Object.fromEntries(Object.entries(processDataAll).filter(([n]) => prefixOf(n) === scope))), [processDataAll, scope])
  const dimData = useMemo(() => (!scope ? dimDataAll : Object.fromEntries(Object.entries(dimDataAll).filter(([n]) => prefixOf(n) === scope))), [dimDataAll, scope])

  const filteredCubes = useMemo(() => {
    if (!cubeData) return []
    const q = search.toLowerCase()
    return Object.keys(cubeData).filter(n => !q || n.toLowerCase().includes(q)).sort()
  }, [cubeData, search])

  const spotQ = dimSpotlight.trim().toLowerCase()
  const spotlitCount = useMemo(() => {
    if (!spotQ || !cubeData) return 0
    return Object.values(cubeData).filter(d => d.dims.some(dim => dim.toLowerCase().includes(spotQ))).length
  }, [spotQ, cubeData])

  return {
    search, setSearch,
    showFeeders, setShowFeeders,
    showCalc, setShowCalc,
    dimFilter, setDimFilter,
    traceDepth, setTraceDepth,
    traceKinds, setTraceKinds,
    dimSpotlight, setDimSpotlight,
    showProcesses, setShowProcesses,
    allTI, setAllTI,
    showDims, setShowDims,
    showLensActions, setShowLensActions,
    scope, setScope,
    prefixes, cubeData, processData, dimData,
    filteredCubes, spotQ, spotlitCount,
  }
}
