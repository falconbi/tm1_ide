import { useQuery, useMutation } from '@tanstack/react-query'
import { useStore } from '@/store'

const extractError = async (r) => {
  try { const d = await r.json(); return new Error(d.error || d.message || r.statusText) } catch { return new Error(r.statusText) }
}
const get   = (url)       => fetch(url).then(async r => { if (!r.ok) throw await extractError(r); return r.json() })
const post  = (url, body) => fetch(url, { method: 'POST',   headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then(async r => { if (!r.ok) throw await extractError(r); return r.json() })
const del   = (url)       => fetch(url, { method: 'DELETE' }).then(async r => { if (!r.ok) throw await extractError(r); return r.json() })
const patch = (url, body) => fetch(url, { method: 'PATCH',  headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then(async r => { if (!r.ok) throw await extractError(r); return r.json() })

const enc = encodeURIComponent

export const useServers   = ()                    => useQuery({ queryKey: ['servers'],                    queryFn: () => get('/api/servers') })
export const useElements  = (server, dim)         => useQuery({ queryKey: ['elements', server, dim],      queryFn: () => get(`/api/elements?server=${enc(server)}&dimension=${enc(dim)}`),  enabled: !!server && !!dim })
export const useEdges     = (server, dim)         => useQuery({ queryKey: ['edges', server, dim],         queryFn: () => get(`/api/edges?server=${enc(server)}&dimension=${enc(dim)}`),     enabled: !!server && !!dim })
export const useCubes    = (server)     => useQuery({ queryKey: ['cubes', server],     queryFn: () => get(`/api/cubes?server=${enc(server)}`),      enabled: !!server })
export const useDims     = (server)     => useQuery({ queryKey: ['dims', server],      queryFn: () => get(`/api/dimensions?server=${enc(server)}`),  enabled: !!server })
export const useProcs    = (server)     => useQuery({ queryKey: ['procs', server],     queryFn: () => get(`/api/processes?server=${enc(server)}`),   enabled: !!server })
export const useChores   = (server)     => useQuery({ queryKey: ['chores', server],    queryFn: () => get(`/api/chores?server=${enc(server)}`),      enabled: !!server })
export const useRules    = (server, cube) => useQuery({ queryKey: ['rules', server, cube], queryFn: () => get(`/api/rules?server=${enc(server)}&cube=${enc(cube)}`), enabled: !!server && !!cube })
export const useProcess  = (server, name) => useQuery({ queryKey: ['process', server, name], queryFn: () => get(`/api/process?server=${enc(server)}&name=${enc(name)}`), enabled: !!server && !!name })

export const useSaveRules = () => useMutation({
  mutationFn: ({ server, cube, rules }) =>
    post(`/api/rules?server=${enc(server)}&cube=${enc(cube)}`, { rules }),
})

export const useSaveProcess = () => useMutation({
  mutationFn: ({ server, name, body }) =>
    post(`/api/process?server=${enc(server)}&name=${enc(name)}`, body),
})

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

export const useSubsets = (server, dimension) => {
  const v = useStore(s => s.subsetVersions[`${server}::${dimension}`] ?? 0)
  return useQuery({
    queryKey: ['subsets', server, dimension, v],
    queryFn:  () => get(`/api/subsets?server=${enc(server)}&dimension=${enc(dimension)}`),
    enabled:  !!server && !!dimension,
    staleTime: 0,
  })
}

export const useSubset = (server, dimension, name) => useQuery({
  queryKey: ['subset', server, dimension, name],
  queryFn:  () => get(`/api/subset?server=${enc(server)}&dimension=${enc(dimension)}&name=${enc(name)}`),
  enabled:  !!server && !!dimension && !!name,
})

export const useSaveSubset = () => useMutation({
  mutationFn: ({ server, dimension, name, mdx }) =>
    post(`/api/subset?server=${enc(server)}&dimension=${enc(dimension)}&name=${enc(name)}`, { mdx }),
})

export const usePreviewMDX = () => useMutation({
  mutationFn: ({ server, dimension, mdx }) =>
    post(`/api/subset/preview?server=${enc(server)}&dimension=${enc(dimension)}`, { mdx }),
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

export const useSubsetElements = (server, dimension, name) => useQuery({
  queryKey: ['subset-elements', server, dimension, name],
  queryFn:  () => get(`/api/subset/elements?server=${enc(server)}&dimension=${enc(dimension)}&name=${enc(name)}`),
  enabled:  !!server && !!dimension && !!name,
  staleTime: 0,
})

export const useSaveStaticSubset = () => useMutation({
  mutationFn: ({ server, dimension, name, elements }) =>
    post(`/api/subset/static?server=${enc(server)}&dimension=${enc(dimension)}&name=${enc(name)}`, { elements }),
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

export const useSaveView = () => useMutation({
  mutationFn: ({ server, cube, name, mdx }) =>
    post(`/api/view/save?server=${enc(server)}&cube=${enc(cube)}&name=${enc(name)}`, { mdx }),
})

export const useElementsWithAttrs = (server, dim) => useQuery({
  queryKey: ['elements-attrs', server, dim],
  queryFn:  () => get(`/api/elements/attributes?server=${enc(server)}&dimension=${enc(dim)}`),
  enabled:  !!server && !!dim,
  staleTime: 30_000,
})

export const useElementAttrValues = (server, dim, element) => useQuery({
  queryKey: ['element-attrs', server, dim, element],
  queryFn:  () => get(`/api/element/attributes?server=${enc(server)}&dimension=${enc(dim)}&element=${enc(element)}`),
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
  mutationFn: ({ server, dimension, name, type }) =>
    post(`/api/dimension/element?server=${enc(server)}&dimension=${enc(dimension)}`, { name, type }),
})

export const useDeleteElement = () => useMutation({
  mutationFn: ({ server, dimension, name }) =>
    del(`/api/dimension/element?server=${enc(server)}&dimension=${enc(dimension)}&name=${enc(name)}`),
})

export const useRenameElement = () => useMutation({
  mutationFn: ({ server, dimension, name, newName }) =>
    patch(`/api/dimension/element?server=${enc(server)}&dimension=${enc(dimension)}&name=${enc(name)}`, { newName }),
})

export const useAddEdge = () => useMutation({
  mutationFn: ({ server, dimension, parent, child, weight }) =>
    post(`/api/dimension/edge?server=${enc(server)}&dimension=${enc(dimension)}`, { parent, child, weight: weight ?? 1 }),
})

export const useDeleteEdge = () => useMutation({
  mutationFn: ({ server, dimension, parent, child }) =>
    del(`/api/dimension/edge?server=${enc(server)}&dimension=${enc(dimension)}&parent=${enc(parent)}&child=${enc(child)}`),
})

export const useDimCubes = (server, dimension) => useQuery({
  queryKey: ['dim-cubes', server, dimension],
  queryFn:  () => get(`/api/dimension/cubes?server=${enc(server)}&dimension=${enc(dimension)}`),
  enabled:  !!server && !!dimension,
  staleTime: 60_000,
})

export const useCreateAttrDef = () => useMutation({
  mutationFn: ({ server, dimension, name, type }) =>
    post('/api/dimension/attribute-def', { server, dimension, name, type }),
})

export const useDeleteAttrDef = () => useMutation({
  mutationFn: ({ server, dimension, name }) =>
    del(`/api/dimension/attribute-def?server=${enc(server)}&dimension=${enc(dimension)}&name=${enc(name)}`),
})

export const useAttrGrid = (server, dimension) => useQuery({
  queryKey: ['attr-grid', server, dimension],
  queryFn:  () => get(`/api/dimension/attr-grid?server=${enc(server)}&dimension=${enc(dimension)}`),
  enabled:  !!server && !!dimension,
  staleTime: 30_000,
})

export const useWriteElementAttribute = () => useMutation({
  mutationFn: (body) => post('/api/element/attribute', body),
})

export const useUpdateEdgeWeight = () => useMutation({
  mutationFn: ({ server, dimension, parent, child, weight }) =>
    patch(`/api/dimension/edge?server=${enc(server)}&dimension=${enc(dimension)}&parent=${enc(parent)}&child=${enc(child)}`, { weight }),
})
