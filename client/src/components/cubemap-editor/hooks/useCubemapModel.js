import { useCallback, useEffect, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { useLensProcessUsage, cubemapModelQuery } from '@/hooks/useApi'

// NO_LENS_USAGE, not a fresh {}: a new object on every render would re-run the
// map build forever.
const NO_LENS_USAGE = Object.freeze({})

// Model load for the Cube Map: cubes, processes, dimensions, chores and the
// Lens → process usage that decides which Lens-action processes are drawn.
export default function useCubemapModel({ srv }) {
  const queryClient = useQueryClient()
  const [cubeDataAll,    setCubeData]       = useState(null)
  const [processCallers, setProcessCallers] = useState({})
  const [processDataAll, setProcessData]    = useState({})
  const [dimDataAll,     setDimData]        = useState({})
  const [chores,         setChores]         = useState([])
  const [loading,        setLoading]        = useState(false)
  const [error,          setError]          = useState(null)
  const [scanError,      setScanError]      = useState(null)
  const [modelReady,     setModelReady]     = useState(false)

  // Request counter: a slow older server switch must not overwrite a newer map.
  const modelRequestRef = useRef(0)
  const fetchModel = useCallback(async () => {
    const requestId = ++modelRequestRef.current
    setLoading(true); setError(null); setScanError(null); setModelReady(false)
    try {
      const d = await queryClient.fetchQuery({ ...cubemapModelQuery(srv), staleTime: 0 })
      if (requestId !== modelRequestRef.current) return
      setCubeData(d.cubes)
      setProcessCallers(d.processCallers ?? {})
      setProcessData(d.processes ?? {})
      setDimData(d.dims ?? {})
      setChores(d.chores ?? [])
      setScanError(d.scanError ?? null)
      setModelReady(true)
    } catch (e) {
      if (requestId !== modelRequestRef.current) return
      setError(e.message)
      toast.error(`CubeMap: ${e.message}`)
    } finally {
      if (requestId === modelRequestRef.current) setLoading(false)
    }
  }, [srv, queryClient])

  useEffect(() => { fetchModel() }, [fetchModel])
  useEffect(() => () => { modelRequestRef.current++ }, [])

  const { data: lensUsage = NO_LENS_USAGE } = useLensProcessUsage(srv)

  return {
    cubeDataAll, processCallers, processDataAll, dimDataAll, chores,
    loading, error, scanError, modelReady, fetchModel, lensUsage,
  }
}
