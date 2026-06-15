import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useRef, useEffect, useMemo, useCallback } from 'react'
import { useStore } from '@/store'

const extractError = async (r) => {
  if (r.status === 401) window.dispatchEvent(new CustomEvent('tm1-unauthorized'))
  try {
    const d = await r.json()
    const err = new Error(d.error || d.message || r.statusText)
    err.data = d  // preserve full body so callers can read runLog, section, line, etc.
    return err
  } catch { return new Error(r.statusText) }
}
const authHeader = () => ({ 'x-ide-token': localStorage.getItem('tm1-token') ?? '' })
const get   = (url)       => fetch(url, { headers: authHeader() }).then(async r => { if (!r.ok) throw await extractError(r); return r.json() })
const post  = (url, body) => fetch(url, { method: 'POST',   headers: { 'Content-Type': 'application/json', ...authHeader() }, body: JSON.stringify(body) }).then(async r => { if (!r.ok) throw await extractError(r); const d = await r.json(); if (d?.noSession) window.dispatchEvent(new CustomEvent('tm1-no-session')); return d })
const del   = (url)       => fetch(url, { method: 'DELETE', headers: authHeader() }).then(async r => { if (!r.ok) throw await extractError(r); return r.json() })
const patch = (url, body) => fetch(url, { method: 'PATCH',  headers: { 'Content-Type': 'application/json', ...authHeader() }, body: JSON.stringify(body) }).then(async r => { if (!r.ok) throw await extractError(r); return r.json() })

export const useLogin  = () => useMutation({ mutationFn: ({ username, password }) => fetch('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password }) }).then(async r => { if (!r.ok) throw await extractError(r); return r.json() }) })
export const useLogout = () => useMutation({ mutationFn: () => fetch('/api/auth/logout', { method: 'POST', headers: authHeader() }).then(r => r.json()) })

const enc = encodeURIComponent

export const useServers   = ()                    => useQuery({ queryKey: ['servers'],                    queryFn: () => get('/api/servers') })
export const useElements           = (server, dim, hierarchy) => useQuery({ queryKey: ['elements', server, dim, hierarchy],           queryFn: () => get(`/api/elements?server=${enc(server)}&dimension=${enc(dim)}${hierarchy ? `&hierarchy=${enc(hierarchy)}` : ''}`),           enabled: !!server && !!dim })
export const useElementsWithIndex  = (server, dim, hierarchy) => useQuery({ queryKey: ['elements-index', server, dim, hierarchy],     queryFn: () => get(`/api/elements?server=${enc(server)}&dimension=${enc(dim)}${hierarchy ? `&hierarchy=${enc(hierarchy)}` : ''}&index=1`), enabled: !!server && !!dim })
export const useElementsTree  = (server, dim, hierarchy) => useQuery({ queryKey: ['elements-tree', server, dim, hierarchy], queryFn: () => get(`/api/elements/tree?server=${enc(server)}&dimension=${enc(dim)}${hierarchy ? `&hierarchy=${enc(hierarchy)}` : ''}`), enabled: !!server && !!dim, staleTime: 60_000 })
export const useEdges     = (server, dim, hierarchy) => useQuery({ queryKey: ['edges', server, dim, hierarchy],    queryFn: () => get(`/api/edges?server=${enc(server)}&dimension=${enc(dim)}${hierarchy ? `&hierarchy=${enc(hierarchy)}` : ''}`),    enabled: !!server && !!dim })
export const useCubes    = (server)     => useQuery({ queryKey: ['cubes', server],     queryFn: () => get(`/api/cubes?server=${enc(server)}`),      enabled: !!server })
export const useDims     = (server)     => useQuery({ queryKey: ['dims', server],      queryFn: () => get(`/api/dimensions?server=${enc(server)}`),  enabled: !!server })
export const useDeleteDimension = () => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ server, name }) => del(`/api/dimension?server=${enc(server)}&name=${enc(name)}`),
    onSuccess: (_, { server }) => queryClient.invalidateQueries({ queryKey: ['dims', server] }),
  })
}
export const useDeleteCube = () => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ server, name }) => del(`/api/cube?server=${enc(server)}&name=${enc(name)}`),
    onSuccess: (_, { server }) => queryClient.invalidateQueries({ queryKey: ['cubes', server] }),
  })
}
export const useCreateCube = () => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ server, name, dims }) => post('/api/cube', { server, name, dims }),
    onSuccess: (_, { server }) => queryClient.invalidateQueries({ queryKey: ['cubes', server] }),
  })
}
export const useDeleteProcess = () => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ server, name }) => del(`/api/process?server=${enc(server)}&name=${enc(name)}`),
    onSuccess: (_, { server }) => queryClient.invalidateQueries({ queryKey: ['procs', server] }),
  })
}
export const useDeleteChore = () => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ server, name }) => del(`/api/chore?server=${enc(server)}&name=${enc(name)}`),
    onSuccess: (_, { server }) => queryClient.invalidateQueries({ queryKey: ['chores', server] }),
  })
}
export const useDeleteSubset = () => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ server, dimension, name, hierarchy }) =>
      del(`/api/subset?server=${enc(server)}&dimension=${enc(dimension)}&name=${enc(name)}${hierarchy ? `&hierarchy=${enc(hierarchy)}` : ''}`),
    onSuccess: (_, { server, dimension }) =>
      queryClient.invalidateQueries({ queryKey: ['subsets', server, dimension] }),
  })
}
export const useProcs        = (server) => useQuery({ queryKey: ['procs', server],      queryFn: () => get(`/api/processes?server=${enc(server)}`),                enabled: !!server })
export const useODBCProcs    = (server) => useQuery({ queryKey: ['procs-odbc', server], queryFn: () => get(`/api/processes?server=${enc(server)}&datasource=odbc`), enabled: !!server, staleTime: 30_000 })
export const useChores          = (server) => useQuery({ queryKey: ['chores', server],          queryFn: () => get(`/api/chores?server=${enc(server)}`),          enabled: !!server })
export const useChore           = (server, name) => useQuery({ queryKey: ['chore', server, name], queryFn: () => get(`/api/chore?server=${enc(server)}&name=${enc(name)}`), enabled: !!server && !!name })
export const useControlObjects  = (server) => useQuery({ queryKey: ['control-objects', server], queryFn: () => get(`/api/control/objects?server=${enc(server)}`), enabled: !!server, staleTime: 60_000 })
export const useRules    = (server, cube) => useQuery({ queryKey: ['rules', server, cube], queryFn: () => get(`/api/rules?server=${enc(server)}&cube=${enc(cube)}`), enabled: !!server && !!cube })
export const useProcess  = (server, name) => useQuery({ queryKey: ['process', server, name], queryFn: () => get(`/api/process?server=${enc(server)}&name=${enc(name)}`), enabled: !!server && !!name })

export const useSaveRules = () => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ server, cube, rules }) =>
      post(`/api/rules?server=${enc(server)}&cube=${enc(cube)}`, { rules }),
    onSuccess: (_, { server, cube }) =>
      queryClient.invalidateQueries({ queryKey: ['rules', server, cube] }),
  })
}

export const useSaveProcess = () => useMutation({
  mutationFn: ({ server, name, body }) =>
    post(`/api/process?server=${enc(server)}&name=${enc(name)}`, body),
})

export const useDebugProcess = () => useMutation({
  mutationFn: ({ server, name, params, sections, watches, breakpoints }) => {
    const bpArrays = Object.fromEntries(
      Object.entries(breakpoints ?? {}).map(([k, v]) => [k, [...(v instanceof Set ? v : [])]])
    )
    return post('/api/process/debug', { server, name, params, sections, watches, breakpoints: bpArrays })
  },
})

export const useSearchProcesses = () => useMutation({
  mutationFn: ({ server, q }) =>
    get(`/api/processes/search?server=${enc(server)}&q=${enc(q)}`),
})

export const useFetchProcessLog = () => useMutation({
  mutationFn: ({ server, name }) =>
    get(`/api/process/log?server=${enc(server)}&name=${enc(name)}`),
})

export const useCreateProcess = () => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ server, name }) =>
      post(`/api/process/create?server=${enc(server)}&name=${enc(name)}`, {}),
    onSuccess: (_, { server }) =>
      queryClient.invalidateQueries({ queryKey: ['procs', server] }),
  })
}

export const useCreateChore = () => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ server, name, body }) =>
      post(`/api/chore?server=${enc(server)}`, { Name: name, ...body }),
    onSuccess: (_, { server }) => {
      queryClient.invalidateQueries({ queryKey: ['chores', server] })
    },
  })
}

export const useSaveChore = () => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ server, name, body }) =>
      patch(`/api/chore?server=${enc(server)}&name=${enc(name)}`, body),
    onSuccess: (_, { server, name }) => {
      queryClient.invalidateQueries({ queryKey: ['chore', server, name] })
      queryClient.invalidateQueries({ queryKey: ['chores', server] })
    },
  })
}

export const useRunProcess = () => useMutation({
  mutationFn: ({ server, name, params }) =>
    post(`/api/process/run?server=${enc(server)}&name=${enc(name)}`, { params }),
})

export const useViews = (server, cube) => useQuery({
  queryKey: ['views', server, cube],
  queryFn:  () => get(`/api/views?server=${enc(server)}&cube=${enc(cube)}`),
  enabled:  !!server && !!cube,
})

export const useLineage = (server, cube, enabled) => useQuery({
  queryKey: ['lineage', server, cube],
  queryFn:  () => get(`/api/lineage?server=${enc(server)}&cube=${enc(cube)}`),
  enabled:  !!server && !!cube && !!enabled,
  staleTime: 30_000,
})

export const useLineageConsumers = (server, cube, enabled) => useQuery({
  queryKey: ['lineage-consumers', server, cube],
  queryFn:  () => get(`/api/lineage/consumers?server=${enc(server)}&cube=${enc(cube)}`),
  enabled:  !!server && !!cube && !!enabled,
  staleTime: 30_000,
})

export const useSubsets = (server, dimension, hierarchy) => {
  const v = useStore(s => s.subsetVersions[`${server}::${dimension}`] ?? 0)
  return useQuery({
    queryKey: ['subsets', server, dimension, hierarchy, v],
    queryFn:  () => get(`/api/subsets?server=${enc(server)}&dimension=${enc(dimension)}${hierarchy ? `&hierarchy=${enc(hierarchy)}` : ''}`),
    enabled:  !!server && !!dimension,
    staleTime: 0,
  })
}

export const useSubset = (server, dimension, name, hierarchy) => useQuery({
  queryKey: ['subset', server, dimension, name, hierarchy],
  queryFn:  () => get(`/api/subset?server=${enc(server)}&dimension=${enc(dimension)}&name=${enc(name)}${hierarchy ? `&hierarchy=${enc(hierarchy)}` : ''}`),
  enabled:  !!server && !!dimension && !!name,
})

export const useSaveSubset = () => useMutation({
  mutationFn: ({ server, dimension, name, mdx, hierarchy }) =>
    post(`/api/subset?server=${enc(server)}&dimension=${enc(dimension)}&name=${enc(name)}${hierarchy ? `&hierarchy=${enc(hierarchy)}` : ''}`, { mdx }),
})

export const usePreviewMDX = () => useMutation({
  mutationFn: ({ server, dimension, mdx, hierarchy }) =>
    post(`/api/subset/preview?server=${enc(server)}&dimension=${enc(dimension)}${hierarchy ? `&hierarchy=${enc(hierarchy)}` : ''}`, { mdx }),
})

export const useGenerateMDX = () => useMutation({
  mutationFn: ({ server, dimension, prompt }) =>
    post(`/api/subset/generate`, { server, dimension, prompt }),
})

export const useDimAttributes = (server, dimension) => useQuery({
  queryKey: ['dim-attributes', server, dimension],
  queryFn:  () => get(`/api/dimension/attributes?server=${enc(server)}&dimension=${enc(dimension)}`),
  enabled:  !!server && !!dimension,
  staleTime: 60_000,
})

export const useAttributeValues = (server, dimension, attribute) => useQuery({
  queryKey: ['attribute-values', server, dimension, attribute],
  queryFn:  () => get(`/api/dimension/attribute-values?server=${enc(server)}&dimension=${enc(dimension)}&attribute=${enc(attribute)}`),
  enabled:  !!server && !!dimension && !!attribute,
  staleTime: 60_000,
})

export const useSubsetElements = (server, dimension, name, hierarchy) => useQuery({
  queryKey: ['subset-elements', server, dimension, name, hierarchy],
  queryFn:  () => get(`/api/subset/elements?server=${enc(server)}&dimension=${enc(dimension)}&name=${enc(name)}${hierarchy ? `&hierarchy=${enc(hierarchy)}` : ''}`),
  enabled:  !!server && !!dimension && !!name,
  staleTime: 0,
})

export const useSaveStaticSubset = () => useMutation({
  mutationFn: ({ server, dimension, name, elements, hierarchy }) =>
    post(`/api/subset/static?server=${enc(server)}&dimension=${enc(dimension)}&name=${enc(name)}${hierarchy ? `&hierarchy=${enc(hierarchy)}` : ''}`, { elements }),
})

export const useCubeDimensions = (server, cube) => useQuery({
  queryKey: ['cube-dims', server, cube],
  queryFn:  () => get(`/api/cube/dimensions?server=${enc(server)}&cube=${enc(cube)}`),
  enabled:  !!server && !!cube,
  staleTime: 60_000,
})

export const useView = (server, cube, name) => useQuery({
  queryKey: ['view', server, cube, name],
  queryFn:  () => get(`/api/view?server=${enc(server)}&cube=${enc(cube)}&name=${enc(name)}`),
  enabled:  !!server && !!cube && !!name,
})

export const useExecuteView = () => useMutation({
  mutationFn: ({ server, cube, view }) =>
    post(`/api/view/execute?server=${enc(server)}&cube=${enc(cube)}&view=${enc(view)}`, {}),
})

export const useViewAxes = () => useMutation({
  mutationFn: ({ server, cube, view }) =>
    get(`/api/view/axes?server=${enc(server)}&cube=${enc(cube)}&view=${enc(view)}`),
})

export const useExecuteMDX = () => useMutation({
  mutationFn: ({ server, mdx }) =>
    post(`/api/mdx/execute?server=${enc(server)}`, { mdx }),
})

export const useExecuteViewSuppressed = () => useMutation({
  mutationFn: ({ server, cube, view, suppressZeros }) =>
    post(`/api/view/execute-suppressed?server=${enc(server)}&cube=${enc(cube)}&view=${enc(view)}`, { suppressZeros }),
})

export const useSaveView = () => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ server, cube, name, mdx, nativeAxes }) =>
      post(`/api/view/save?server=${enc(server)}&cube=${enc(cube)}&name=${enc(name)}`,
           nativeAxes ? { nativeAxes } : { mdx }),
    onSuccess: (_data, { server, cube }) => {
      qc.invalidateQueries({ queryKey: ['views', server, cube] })
    },
  })
}

export const useSetDefaultView = () => {
    const qc = useQueryClient()
    return useMutation({
        mutationFn: ({ server, cube, name }) =>
            post(`/api/view/set-default?server=${enc(server)}&cube=${enc(cube)}&name=${enc(name)}`),
        onSuccess: (_, { server, cube }) =>
            qc.invalidateQueries({ queryKey: ['default-view', server, cube] }),
    })
}

export const useDeleteView = () => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ server, cube, name }) => del(`/api/view?server=${enc(server)}&cube=${enc(cube)}&name=${enc(name)}`),
    onSuccess: (_data, { server, cube }) => {
      qc.invalidateQueries({ queryKey: ['views', server, cube] })
    },
  })
}

export const useMultiFormatAttrs = (server, dims) => useQuery({
  queryKey: ['format-attrs', server, ...(dims ?? []).slice().sort()],
  queryFn:  () => get(`/api/dimensions/format-attrs?server=${enc(server)}&dims=${(dims ?? []).map(enc).join(',')}`),
  enabled:  !!server && !!(dims?.length),
  staleTime: 60_000,
})

export const useElementsWithAttrs = (server, dim, hierarchy) => useQuery({
  queryKey: ['elements-attrs', server, dim, hierarchy],
  queryFn:  () => get(`/api/elements/attributes?server=${enc(server)}&dimension=${enc(dim)}${hierarchy ? `&hierarchy=${enc(hierarchy)}` : ''}`),
  enabled:  !!server && !!dim,
  staleTime: 30_000,
})

export const useElementAttrValues = (server, dim, element, hierarchy) => useQuery({
  queryKey: ['element-attrs', server, dim, element, hierarchy],
  queryFn:  () => get(`/api/element/attributes?server=${enc(server)}&dimension=${enc(dim)}&element=${enc(element)}${hierarchy ? `&hierarchy=${enc(hierarchy)}` : ''}`),
  enabled:  !!server && !!dim && !!element,
  staleTime: 30_000,
})

export const useHierarchies = (server, dim) => useQuery({
  queryKey: ['hierarchies', server, dim],
  queryFn:  () => get(`/api/hierarchies?server=${enc(server)}&dimension=${enc(dim)}`),
  enabled:  !!server && !!dim,
  staleTime: 60_000,
})

export const useAddElement = () => useMutation({
  mutationFn: ({ server, dimension, name, type, hierarchy }) =>
    post(`/api/dimension/element?server=${enc(server)}&dimension=${enc(dimension)}${hierarchy ? `&hierarchy=${enc(hierarchy)}` : ''}`, { name, type }),
})

export const useDeleteElement = () => useMutation({
  mutationFn: ({ server, dimension, name, hierarchy }) =>
    del(`/api/dimension/element?server=${enc(server)}&dimension=${enc(dimension)}&name=${enc(name)}${hierarchy ? `&hierarchy=${enc(hierarchy)}` : ''}`),
})

export const useRenameElement = () => useMutation({
  mutationFn: ({ server, dimension, name, newName, hierarchy }) =>
    patch(`/api/dimension/element?server=${enc(server)}&dimension=${enc(dimension)}&name=${enc(name)}${hierarchy ? `&hierarchy=${enc(hierarchy)}` : ''}`, { newName }),
})

export const useAddEdge = () => useMutation({
  mutationFn: ({ server, dimension, parent, child, weight, hierarchy }) =>
    post(`/api/dimension/edge?server=${enc(server)}&dimension=${enc(dimension)}${hierarchy ? `&hierarchy=${enc(hierarchy)}` : ''}`, { parent, child, weight: weight ?? 1 }),
})

export const useDeleteEdge = () => useMutation({
  mutationFn: ({ server, dimension, parent, child, hierarchy }) =>
    del(`/api/dimension/edge?server=${enc(server)}&dimension=${enc(dimension)}&parent=${enc(parent)}&child=${enc(child)}${hierarchy ? `&hierarchy=${enc(hierarchy)}` : ''}`),
})

export const useDimCubes = (server, dimension) => useQuery({
  queryKey: ['dim-cubes', server, dimension],
  queryFn:  () => get(`/api/dimension/cubes?server=${enc(server)}&dimension=${enc(dimension)}`),
  enabled:  !!server && !!dimension,
  staleTime: 60_000,
})

export const useCreateAttrDef = () => useMutation({
  mutationFn: ({ server, dimension, name, type, hierarchy }) =>
    post('/api/dimension/attribute-def', { server, dimension, name, type, hierarchy }),
})

export const useDeleteAttrDef = () => useMutation({
  mutationFn: ({ server, dimension, name, hierarchy }) =>
    del(`/api/dimension/attribute-def?server=${enc(server)}&dimension=${enc(dimension)}&name=${enc(name)}${hierarchy ? `&hierarchy=${enc(hierarchy)}` : ''}`),
})

export const useAttrGrid = (server, dimension, hierarchy) => useQuery({
  queryKey: ['attr-grid', server, dimension, hierarchy],
  queryFn:  () => get(`/api/dimension/attr-grid?server=${enc(server)}&dimension=${enc(dimension)}${hierarchy ? `&hierarchy=${enc(hierarchy)}` : ''}`),
  enabled:  !!server && !!dimension,
  staleTime: 30_000,
})

export const useAliasValues = (server, dim, aliasAttr) => useQuery({
  queryKey: ['alias-values', server, dim, aliasAttr],
  queryFn:  () => get(`/api/dimension/alias-values?server=${enc(server)}&dimension=${enc(dim)}&alias=${enc(aliasAttr)}`),
  enabled:  !!server && !!dim && !!aliasAttr,
  staleTime: 60_000,
})

export const useWriteElementAttribute = () => useMutation({
  mutationFn: (body) => post('/api/element/attribute', body),
})

export const useUpdateEdgeWeight = () => useMutation({
  mutationFn: ({ server, dimension, parent, child, weight, hierarchy }) =>
    patch(`/api/dimension/edge?server=${enc(server)}&dimension=${enc(dimension)}&parent=${enc(parent)}&child=${enc(child)}${hierarchy ? `&hierarchy=${enc(hierarchy)}` : ''}`, { weight }),
})

export const useSubsetUsage = (server, dimension, subset) => useQuery({
  queryKey: ['subset-usage', server, dimension, subset],
  queryFn:  () => get(`/api/subset/usage?server=${enc(server)}&dimension=${enc(dimension)}&subset=${enc(subset)}`),
  enabled:  !!server && !!dimension && !!subset,
  staleTime: 0,
})

export const useViewUsage = (server, cube, view) => useQuery({
  queryKey: ['view-usage', server, cube, view],
  queryFn:  () => get(`/api/view/usage?server=${enc(server)}&cube=${enc(cube)}&view=${enc(view)}`),
  enabled:  false,
  staleTime: 0,
})

export const useDimensionUsage = (server, dimension) => useQuery({
  queryKey: ['dimension-usage', server, dimension],
  queryFn:  () => get(`/api/dimension/usage?server=${enc(server)}&dimension=${enc(dimension)}`),
  enabled:  !!server && !!dimension,
  staleTime: 0,
})

export const useCubeUsage = (server, cube) => useQuery({
  queryKey: ['cube-usage', server, cube],
  queryFn:  () => get(`/api/cube/usage?server=${enc(server)}&cube=${enc(cube)}`),
  enabled:  !!server && !!cube,
  staleTime: 0,
})

export const useProcessUsage = (server, process) => useQuery({
  queryKey: ['process-usage', server, process],
  queryFn:  () => get(`/api/process/usage?server=${enc(server)}&process=${enc(process)}`),
  enabled:  !!server && !!process,
  staleTime: 0,
})

export const useCreateHierarchy = () => useMutation({
  mutationFn: ({ server, dimension, name }) =>
    post('/api/dimension/hierarchy', { server, dimension, name }),
})

export const useDeleteHierarchy = () => useMutation({
  mutationFn: ({ server, dimension, name }) =>
    del(`/api/dimension/hierarchy?server=${enc(server)}&dimension=${enc(dimension)}&name=${enc(name)}`),
})

export const usePawBookUsage = (server, cube, view) => useQuery({
  queryKey: ['paw-book-usage', server, cube, view],
  queryFn:  () => get(`/api/paw/book-usage?server=${enc(server)}&cube=${enc(cube)}${view ? `&view=${enc(view)}` : ''}`),
  enabled:  !!server && !!cube,
  staleTime: 0,
})

// ── SQL Editor ────────────────────────────────────────────────────────────────
export const useSQLConnections  = () => useQuery({ queryKey: ['sql-connections'], queryFn: () => get('/api/sql/connections'), staleTime: 0 })
export const useSaveSQLConn     = () => { const qc = useQueryClient(); return useMutation({ mutationFn: (conn) => post('/api/sql/connections', conn), onSuccess: () => qc.invalidateQueries({ queryKey: ['sql-connections'] }) }) }
export const useDeleteSQLConn   = () => { const qc = useQueryClient(); return useMutation({ mutationFn: (id)   => del(`/api/sql/connections/${enc(id)}`),  onSuccess: () => qc.invalidateQueries({ queryKey: ['sql-connections'] }) }) }
export const useTestSQLConn     = () => useMutation({ mutationFn: (conn) => post('/api/sql/test', conn) })
export const useExecuteSQL      = () => useMutation({ mutationFn: ({ connectionId, sql, params }) => post('/api/sql/execute', { connectionId, sql, params }) })
export const useSQLSchema       = (id) => useQuery({ queryKey: ['sql-schema', id], queryFn: () => get(`/api/sql/schema/${enc(id)}`), enabled: !!id, staleTime: 60_000 })
export const usePostToTI            = () => useMutation({ mutationFn: (body) => post('/api/sql/post-to-ti', body) })
export const usePreviewDatasource   = () => useMutation({ mutationFn: (body) => post('/api/sql/preview-datasource', body) })
export const useSQLQueries     = (connectionId) => useQuery({ queryKey: ['sql-queries', connectionId], queryFn: () => get(`/api/sql/queries${connectionId ? `?connectionId=${enc(connectionId)}` : ''}`), staleTime: 0 })
export const useSaveSQLQuery   = () => { const qc = useQueryClient(); return useMutation({ mutationFn: (q) => post('/api/sql/queries', q), onSuccess: (_, v) => qc.invalidateQueries({ queryKey: ['sql-queries', v.connectionId] }) }) }
export const useDeleteSQLQuery = () => { const qc = useQueryClient(); return useMutation({ mutationFn: ({ id, connectionId }) => del(`/api/sql/queries/${enc(id)}`), onSuccess: (_, v) => qc.invalidateQueries({ queryKey: ['sql-queries', v.connectionId] }) }) }

export const useCurrentUser      = (server) => useQuery({ queryKey: ['whoami', server], queryFn: () => get(`/api/whoami?server=${enc(server)}`), enabled: !!server, staleTime: 300_000 })
export const useWriteCell        = () => useMutation({ mutationFn: (body) => post('/api/cells/write', body) })
export const useCreateDimension  = () => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (body) => post('/api/dimension/create', body),
    onSuccess: (_, { server }) => queryClient.invalidateQueries({ queryKey: ['dims', server] }),
  })
}
export const useBulkDimImport    = () => useMutation({ mutationFn: (body) => post('/api/dimension/bulk-import', body) })
export const useBulkAttrImport   = () => useMutation({ mutationFn: (body) => post('/api/dimension/bulk-attr-import', body) })
export const useTraceCellCalc    = () => useMutation({ mutationFn: (body) => post('/api/cube/trace', body) })
export const useTransactionLog   = () => useMutation({
  mutationFn: ({ server, cube, top = 200, elements = null }) => {
    const p = new URLSearchParams({ server, cube, top })
    if (elements) p.set('elements', JSON.stringify(elements))
    return get(`/api/transactions?${p}`)
  },
})
export const useJobs             = (server, opts = {}) => useQuery({ queryKey: ['jobs', server], queryFn: () => get(`/api/jobs?server=${enc(server)}`), enabled: !!server, staleTime: 0, ...opts })
export const useCancelJob        = () => useMutation({ mutationFn: ({ server, id }) => post(`/api/job/cancel?server=${enc(server)}&id=${enc(id)}`, {}) })
export const useChoreActions     = () => useMutation({ mutationFn: ({ action, server, name }) => post(`/api/chore/${action}?server=${enc(server)}&name=${enc(name)}`, {}) })

// ── Server admin ──────────────────────────────────────────────────────────────
export const useServerMetrics        = (server, opts = {}) => useQuery({ queryKey: ['metrics', server], queryFn: () => get(`/api/admin/metrics?server=${enc(server)}`), enabled: !!server, staleTime: 15_000, ...opts })
export const useActiveConfiguration  = (server, opts = {}) => useQuery({ queryKey: ['config', server],  queryFn: () => get(`/api/admin/configuration?server=${enc(server)}`), enabled: !!server, staleTime: 30_000, ...opts })
export const usePatchConfiguration   = () => useMutation({ mutationFn: ({ server, section, values }) => patch('/api/admin/configuration', { server, section, values }) })
export const useMaintenanceMode      = () => useMutation({ mutationFn: ({ server, enable }) => post(`/api/admin/maintenance/${enable ? 'enable' : 'disable'}`, { server }) })

// ── TM1 Sessions (who is connected) ──────────────────────────────────────────
export const useSessions          = (server, opts = {}) => useQuery({ queryKey: ['sessions', server], queryFn: () => get(`/api/sessions?server=${enc(server)}`), enabled: !!server, staleTime: 0, ...opts })
export const useDisconnectSession = () => useMutation({ mutationFn: ({ server, id }) => del(`/api/session?server=${enc(server)}&id=${enc(id)}`) })
export const useThreads           = (server, opts = {}) => useQuery({ queryKey: ['threads', server], queryFn: () => get(`/api/threads?server=${enc(server)}`), enabled: !!server, staleTime: 0, ...opts })
export const useCancelThread      = () => useMutation({ mutationFn: ({ server, id }) => post(`/api/thread/cancel?server=${enc(server)}&id=${enc(id)}`, {}) })

// ── Change log / Work sessions ────────────────────────────────────────────────
export const useActiveWorkSession  = (server) => useQuery({ queryKey: ['work-session-active', server], queryFn: () => get(`/api/sessions/active?server=${enc(server)}`), enabled: !!server, staleTime: 0, refetchInterval: 0 })
export const useWorkSessions       = (server) => useQuery({ queryKey: ['work-sessions', server], queryFn: () => get(`/api/sessions?server=${enc(server)}`), enabled: !!server, staleTime: 0 })
export const useWorkSessionLog     = (sessionId) => useQuery({ queryKey: ['work-session-log', sessionId], queryFn: () => get(`/api/sessions/${enc(sessionId)}/log`), enabled: !!sessionId, staleTime: 0 })
export const useWorkSessionLogVerbose = (sessionId) => useQuery({ queryKey: ['work-session-log-verbose', sessionId], queryFn: () => get(`/api/sessions/${enc(sessionId)}/log/verbose`), enabled: !!sessionId, staleTime: 0 })
export const useRecentLog          = (server) => useQuery({ queryKey: ['recent-log', server], queryFn: () => get(`/api/log/recent?server=${enc(server)}`), enabled: !!server, staleTime: 0 })
export const useStartWorkSession   = () => { const qc = useQueryClient(); return useMutation({ mutationFn: (body) => post('/api/sessions/start', body), onSuccess: (_, v) => { qc.invalidateQueries({ queryKey: ['work-session-active', v.server] }); qc.invalidateQueries({ queryKey: ['work-sessions', v.server] }) } }) }
export const useCloseWorkSession   = () => { const qc = useQueryClient(); return useMutation({ mutationFn: (body) => post('/api/sessions/close', body), onSuccess: (_, v) => { qc.invalidateQueries({ queryKey: ['work-session-active'] }); qc.invalidateQueries({ queryKey: ['work-sessions'] }) } }) }
export const useResumeWorkSession  = () => { const qc = useQueryClient(); return useMutation({ mutationFn: (body) => post('/api/sessions/resume', body), onSuccess: (_, v) => { qc.invalidateQueries({ queryKey: ['work-session-active'] }); qc.invalidateQueries({ queryKey: ['work-sessions'] }) } }) }
export const useObjectHistory      = (server, type, name) => useQuery({ queryKey: ['object-history', server, type, name], queryFn: () => get(`/api/log/object?server=${enc(server)}&type=${enc(type)}&name=${enc(name)}`), enabled: !!(server && type && name), staleTime: 0 })

export function useConflictCheck(server, type, name) {
  const username = useStore(s => s.username)
  const { data: history = [], refetch } = useObjectHistory(server, type, name)
  const baselineRef = useRef(undefined)
  const initializedRef = useRef(false)
  useEffect(() => {
    if (!initializedRef.current && history.length > 0) {
      baselineRef.current = history[0].id ?? null
      initializedRef.current = true
    }
  }, [history])
  const openConflict = useMemo(() => {
    if (!username || !initializedRef.current) return null
    const latest = history[0]
    if (!latest?.user || latest.user === username) return null
    if (latest.id === baselineRef.current) return null
    return latest
  }, [history, username])
  const checkBeforeSave = useCallback(async () => {
    const result = await refetch()
    const fresh = result.data ?? []
    const latest = fresh[0]
    if (!latest) return null
    if (latest.id === baselineRef.current) return null
    if (!latest.user || latest.user === username) { baselineRef.current = latest.id; return null }
    return latest
  }, [refetch, username])
  return { openConflict, checkBeforeSave }
}
export const useRollbackEntry            = () => { const qc = useQueryClient(); return useMutation({ mutationFn: (body) => post('/api/log/rollback', body), onSuccess: () => { qc.invalidateQueries({ queryKey: ['object-history'] }); qc.invalidateQueries({ queryKey: ['work-session-log'] }); qc.invalidateQueries({ queryKey: ['work-sessions'] }) } }) }
export const useUpdateSessionDescription = () => { const qc = useQueryClient(); return useMutation({ mutationFn: ({ id, description }) => patch(`/api/sessions/${enc(id)}/description`, { description }), onSuccess: (_, { server }) => qc.invalidateQueries({ queryKey: ['work-sessions', server] }) }) }

// ── Deploy pipeline ───────────────────────────────────────────────────────────
export const useDeployPackages = () => useQuery({ queryKey: ['deploy-packages'], queryFn: () => get('/api/deploy/packages'), staleTime: 0 })
export const useDeployBaseline = () => useQuery({ queryKey: ['deploy-baseline'], queryFn: () => get('/api/deploy/baseline'), staleTime: 60_000 })
export const useDeploySeed     = () => { const qc = useQueryClient(); return useMutation({ mutationFn: (body) => post('/api/deploy/seed', body), onSuccess: () => qc.invalidateQueries({ queryKey: ['deploy-baseline'] }) }) }
export const useDeployDiff     = () => useMutation({ mutationFn: (body) => post('/api/deploy/diff',    body) })
export const useDeployPackage  = () => { const qc = useQueryClient(); return useMutation({ mutationFn: (body) => post('/api/deploy/package', body), onSuccess: () => qc.invalidateQueries({ queryKey: ['deploy-packages'] }) }) }
export const useDeployRisk     = () => useMutation({ mutationFn: (body) => post('/api/deploy/risk',    body) })
export const useDeployExecute  = () => useMutation({ mutationFn: (body) => post('/api/deploy/execute', body) })

// ── User management ───────────────────────────────────────────────────────────
export const useClients      = (server) => useQuery({ queryKey: ['clients', server], queryFn: () => get(`/api/users?server=${enc(server)}`), enabled: !!server, staleTime: 0 })
export const useGroups       = (server) => useQuery({ queryKey: ['groups',  server], queryFn: () => get(`/api/groups?server=${enc(server)}`),  enabled: !!server, staleTime: 60_000 })
export const useClientGroups = (server, name) => useQuery({ queryKey: ['client-groups', server, name], queryFn: () => get(`/api/users/${enc(name)}/groups?server=${enc(server)}`), enabled: !!(server && name), staleTime: 0 })
export const useCreateClient = () => { const qc = useQueryClient(); return useMutation({ mutationFn: (body) => post('/api/users/provision', body), onSuccess: (_, v) => qc.invalidateQueries({ queryKey: ['clients', v.server] }) }) }
export const useResetClientPassword = () => useMutation({ mutationFn: ({ server, name, password }) => post(`/api/users/${enc(name)}/password`, { server, password }) })
export const useUpdateClient = () => { const qc = useQueryClient(); return useMutation({ mutationFn: ({ server, name, ...p }) => patch(`/api/users/${enc(name)}`, { server, ...p }), onSuccess: (_, v) => qc.invalidateQueries({ queryKey: ['clients', v.server] }) }) }
export const useDeleteClient = () => { const qc = useQueryClient(); return useMutation({ mutationFn: ({ server, name }) => del(`/api/users/${enc(name)}?server=${enc(server)}`), onSuccess: (_, v) => qc.invalidateQueries({ queryKey: ['clients', v.server] }) }) }
export const useAddClientToGroup    = () => { const qc = useQueryClient(); return useMutation({ mutationFn: ({ server, name, group }) => post(`/api/users/${enc(name)}/groups`, { server, group }), onSuccess: (_, v) => qc.invalidateQueries({ queryKey: ['client-groups', v.server, v.name] }) }) }
export const useRemoveClientFromGroup = () => { const qc = useQueryClient(); return useMutation({ mutationFn: ({ server, name, group }) => del(`/api/users/${enc(name)}/groups/${enc(group)}?server=${enc(server)}`), onSuccess: (_, v) => qc.invalidateQueries({ queryKey: ['client-groups', v.server, v.name] }) }) }

// ── Files availability probe ──────────────────────────────────────────────────
export const useFilesAvailable = (server) => useQuery({
  queryKey: ['files-available', server],
  queryFn:  async () => {
    const r = await fetch(`/api/files/list?server=${enc(server)}&path=${enc(JSON.stringify(['Files']))}`)
    if (r.status === 404) return false
    return true
  },
  enabled:   !!server,
  staleTime: Infinity,
  retry:     false,
})
