// ── Parameter type catalog ────────────────────────────────────────────────────
// Verified from IBM Planning Analytics: TM1 Reference
// Types: 'cubename' | 'dimname' | 'element' | 'attribute' | 'hiername' | 'value' | 'n'
// '*' suffix on last entry = that type repeats for all remaining params

// ── Rules Functions (Chapter 2) ───────────────────────────────────────────────
const RULES_CATALOG = {
  // Cube Data (Rules only)
  DB:                     ['cubename', 'element*'],
  CELLVALUEN:             ['cubename', 'element*'],
  CELLVALUES:             ['cubename', 'element*'],

  // Dimension Information
  TABDIM:                 ['cubename', 'n'],
  DIMSIZ:                 ['dimname'],
  DIMIX:                  ['dimname', 'element'],
  DNEXT:                  ['dimname', 'element'],
  DNLEV:                  ['dimname'],
  DTYPE:                  ['dimname', 'element'],

  // Element Information (classic 2-arg forms, no hierarchy)
  ELCOMP:                 ['dimname', 'element', 'n'],
  ELCOMPN:                ['dimname', 'element'],
  ELLEV:                  ['dimname', 'element'],
  ELPAR:                  ['dimname', 'element', 'n'],
  ELPARN:                 ['dimname', 'element'],
  ELWEIGHT:               ['dimname', 'element', 'element'],
  ELISANC:                ['dimname', 'element', 'element'],
  ELISCOMP:               ['dimname', 'element', 'element'],
  ELISPAR:                ['dimname', 'element', 'element'],

  // Element Information (hierarchy-aware forms)
  ELEMENTCOMPONENT:       ['dimname', 'hiername', 'element', 'n'],
  ELEMENTCOMPONENTCOUNT:  ['dimname', 'hiername', 'element'],
  ELEMENTCOUNT:           ['dimname', 'hiername'],
  ELEMENTFIRST:           ['dimname', 'hiername'],
  ELEMENTINDEX:           ['dimname', 'hiername', 'element'],
  ELEMENTISANCESTOR:      ['dimname', 'hiername', 'element', 'element'],
  ELEMENTISCOMPONENT:     ['dimname', 'hiername', 'element', 'element'],
  ELEMENTISPARENT:        ['dimname', 'hiername', 'element', 'element'],
  ELEMENTLEVEL:           ['dimname', 'hiername', 'element'],
  ELEMENTNAME:            ['dimname', 'hiername', 'n'],
  ELEMENTNEXT:            ['dimname', 'hiername', 'element'],
  ELEMENTPARENT:          ['dimname', 'hiername', 'element', 'n'],
  ELEMENTPARENTCOUNT:     ['dimname', 'hiername', 'element'],
  ELEMENTTYPE:            ['dimname', 'hiername', 'element'],
  ELEMENTWEIGHT:          ['dimname', 'hiername', 'element', 'element'],

  // Attribute functions (Rules and TI)
  ATTRN:                  ['dimname', 'element', 'attribute'],
  ATTRS:                  ['dimname', 'element', 'attribute'],
  CUBEATTRN:              ['cubename', 'attribute'],
  CUBEATTRS:              ['cubename', 'attribute'],
  DIMENSIONATTRN:         ['dimname', 'attribute'],
  DIMENSIONATTRS:         ['dimname', 'attribute'],
  ELEMENTATTRN:           ['dimname', 'hiername', 'element', 'attribute'],
  ELEMENTATTRS:           ['dimname', 'hiername', 'element', 'attribute'],
}

// ── TurboIntegrator Functions (Chapter 5) ─────────────────────────────────────
const TI_CATALOG = {
  // ── Cell read/write ───────────────────────────────────────────────────────
  CELLGETN:               ['cubename', 'element*'],
  CELLGETS:               ['cubename', 'element*'],
  CELLPUTN:               ['value', 'cubename', 'element*'],
  CELLPUTS:               ['value', 'cubename', 'element*'],
  CELLINCREMENTN:         ['value', 'cubename', 'element*'],
  CELLISUPDATEABLE:       ['cubename', 'element*'],

  // ── Cube management ───────────────────────────────────────────────────────
  CUBECREATE:                 ['cubename', 'dimname*'],
  CUBEDESTROY:                ['cubename'],
  CUBEEXISTS:                 ['cubename'],
  CUBESAVEDATA:               ['cubename'],
  CUBETIMELASTUPDATED:        ['cubename'],
  CUBEUNLOAD:                 ['cubename'],
  CUBESETLOGCHANGES:          ['cubename', 'value'],

  // ── Rules management ──────────────────────────────────────────────────────
  CUBEPROCESSFEEDERS:         ['cubename'],
  CUBERULEAPPEND:             ['cubename', 'value', 'value'],
  CUBERULEDESTROY:            ['cubename'],

  // ── Dimension management ──────────────────────────────────────────────────
  DIMENSIONCREATE:                        ['dimname'],
  DIMENSIONDESTROY:                       ['dimname'],
  DIMENSIONEXISTS:                        ['dimname'],
  DIMENSIONTIMELASTUPDATED:               ['dimname'],
  DIMENSIONUPDATEDIRECT:                  ['dimname'],
  DIMENSIONHIERARCHYCREATE:               ['dimname', 'hiername'],
  DIMENSIONSORTORDER:                     ['dimname', 'value', 'value', 'value', 'value'],
  DIMENSIONELEMENTINSERT:                 ['dimname', 'element', 'value', 'value'],
  DIMENSIONELEMENTINSERTDIRECT:           ['dimname', 'element', 'value', 'value'],
  DIMENSIONELEMENTDELETE:                 ['dimname', 'element'],
  DIMENSIONELEMENTDELETEDIRECT:           ['dimname', 'element'],
  DIMENSIONELEMENTEXISTS:                 ['dimname', 'element'],
  DIMENSIONELEMENTPRINCIPALNAME:          ['dimname', 'element'],
  DIMENSIONELEMENTCOMPONENTADD:           ['dimname', 'element', 'element', 'value'],
  DIMENSIONELEMENTCOMPONENTADDDIRECT:     ['dimname', 'element', 'element', 'value'],
  DIMENSIONELEMENTCOMPONENTDELETE:        ['dimname', 'element', 'element'],
  DIMENSIONELEMENTCOMPONENTDELETEDIRECT:  ['dimname', 'element', 'element'],
  DIMENSIONTOPELEMENTINSERT:              ['dimname', 'element', 'value'],
  DIMENSIONTOPELEMENTINSERTDIRECT:        ['dimname', 'element', 'value'],

  // ── Hierarchy management ──────────────────────────────────────────────────
  HIERARCHYCREATE:                            ['dimname', 'hiername'],
  HIERARCHYDESTROY:                           ['dimname', 'hiername'],
  HIERARCHYCONTAINSALLLEAVES:                 ['dimname', 'hiername'],
  HIERARCHYDELETEALLEMENTS:                   ['dimname', 'hiername'],
  HIERARCHYDELETEELEMENTS:                    ['dimname', 'hiername', 'value'],
  HIERARCHYELEMENTCOMPONENTADD:               ['dimname', 'hiername', 'element', 'element', 'value'],
  HIERARCHYELEMENTCOMPONENTADDDIRECT:         ['dimname', 'hiername', 'element', 'element', 'value'],
  HIERARCHYELEMENTCOMPONENTDELETE:            ['dimname', 'hiername', 'element', 'element'],
  HIERARCHYELEMENTCOMPONENTDELETEDIRECT:      ['dimname', 'hiername', 'element', 'element'],
  HIERARCHYELEMENTDELETE:                     ['dimname', 'hiername', 'element'],
  HIERARCHYELEMENTDELETEDIRECT:               ['dimname', 'hiername', 'element'],
  HIERARCHYELEMENTEXISTS:                     ['dimname', 'hiername', 'element'],

  // ── Process control ───────────────────────────────────────────────────────
  EXECUTEPROCESS:     ['value', 'value*'],
  RUNPROCESS:         ['value', 'value*'],
  PROCESSEXISTS:      ['value'],

  // ── Dimension information (also valid in Rules) ───────────────────────────
  TABDIM:             ['cubename', 'n'],
  DIMSIZ:             ['dimname'],
  DIMIX:              ['dimname', 'element'],
  DNEXT:              ['dimname', 'element'],
  DNLEV:              ['dimname'],
  DTYPE:              ['dimname', 'element'],

  // ── Element information — classic (no hierarchy arg) ─────────────────────
  ELCOMP:             ['dimname', 'element', 'n'],
  ELCOMPN:            ['dimname', 'element'],
  ELLEV:              ['dimname', 'element'],
  ELPAR:              ['dimname', 'element', 'n'],
  ELPARN:             ['dimname', 'element'],
  ELWEIGHT:           ['dimname', 'element', 'element'],
  ELISANC:            ['dimname', 'element', 'element'],
  ELISCOMP:           ['dimname', 'element', 'element'],
  ELISPAR:            ['dimname', 'element', 'element'],

  // ── Element information — hierarchy-aware ─────────────────────────────────
  ELEMENTCOMPONENT:       ['dimname', 'hiername', 'element', 'n'],
  ELEMENTCOMPONENTCOUNT:  ['dimname', 'hiername', 'element'],
  ELEMENTCOUNT:           ['dimname', 'hiername'],
  ELEMENTFIRST:           ['dimname', 'hiername'],
  ELEMENTINDEX:           ['dimname', 'hiername', 'element'],
  ELEMENTISANCESTOR:      ['dimname', 'hiername', 'element', 'element'],
  ELEMENTISCOMPONENT:     ['dimname', 'hiername', 'element', 'element'],
  ELEMENTISPARENT:        ['dimname', 'hiername', 'element', 'element'],
  ELEMENTLEVEL:           ['dimname', 'hiername', 'element'],
  ELEMENTNAME:            ['dimname', 'hiername', 'n'],
  ELEMENTNEXT:            ['dimname', 'hiername', 'element'],
  ELEMENTPARENT:          ['dimname', 'hiername', 'element', 'n'],
  ELEMENTPARENTCOUNT:     ['dimname', 'hiername', 'element'],
  ELEMENTTYPE:            ['dimname', 'hiername', 'element'],
  ELEMENTWEIGHT:          ['dimname', 'hiername', 'element', 'element'],

  // ── Attribute functions ───────────────────────────────────────────────────
  ATTRPUTN:           ['value', 'dimname', 'element', 'attribute'],
  ATTRPUTS:           ['value', 'dimname', 'element', 'attribute'],
  ATTRN:              ['dimname', 'element', 'attribute'],
  ATTRS:              ['dimname', 'element', 'attribute'],
  CUBEATTRN:          ['cubename', 'attribute'],
  CUBEATTRS:          ['cubename', 'attribute'],
  DIMENSIONATTRN:     ['dimname', 'attribute'],
  DIMENSIONATTRS:     ['dimname', 'attribute'],
  ELEMENTATTRN:       ['dimname', 'hiername', 'element', 'attribute'],
  ELEMENTATTRS:       ['dimname', 'hiername', 'element', 'attribute'],
}

// ── Function keyword snippets ─────────────────────────────────────────────────
// Shown when typing a function name (not inside a call).
// Format: { label, snippet, detail }
const TI_KEYWORDS = [
  // Cell
  { label: 'CellPutN',      snippet: 'CellPutN(${1:value}, ${2:cube}, ${3:elements});',             detail: 'Write numeric cell value' },
  { label: 'CellPutS',      snippet: 'CellPutS(${1:value}, ${2:cube}, ${3:elements});',             detail: 'Write string cell value' },
  { label: 'CellGetN',      snippet: 'CellGetN(${1:cube}, ${2:elements})',                          detail: 'Read numeric cell value' },
  { label: 'CellGetS',      snippet: 'CellGetS(${1:cube}, ${2:elements})',                          detail: 'Read string cell value' },
  { label: 'CellIncrementN',snippet: 'CellIncrementN(${1:value}, ${2:cube}, ${3:elements});',       detail: 'Increment numeric cell value' },
  // Cube
  { label: 'CubeCreate',    snippet: 'CubeCreate(${1:CubeName}, ${2:Dim1}, ${3:Dim2});',            detail: 'Create a new cube' },
  { label: 'CubeDestroy',   snippet: 'CubeDestroy(${1:CubeName});',                                 detail: 'Delete a cube' },
  { label: 'CubeExists',    snippet: 'CubeExists(${1:CubeName})',                                   detail: 'Returns 1 if cube exists' },
  { label: 'CubeSaveData',  snippet: 'CubeSaveData(${1:CubeName});',                                detail: 'Serialize cube data to disk' },
  { label: 'CubeUnload',    snippet: 'CubeUnload(${1:CubeName});',                                  detail: 'Unload cube from memory' },
  { label: 'CubeProcessFeeders', snippet: 'CubeProcessFeeders(${1:CubeName});',                     detail: 'Reprocess all cube feeders' },
  // Dimension
  { label: 'DimensionCreate',   snippet: 'DimensionCreate(${1:DimName});',                          detail: 'Create a new dimension' },
  { label: 'DimensionDestroy',  snippet: 'DimensionDestroy(${1:DimName});',                         detail: 'Delete a dimension' },
  { label: 'DimensionExists',   snippet: 'DimensionExists(${1:DimName})',                           detail: 'Returns 1 if dimension exists' },
  { label: 'DimensionElementInsert',       snippet: "DimensionElementInsert(${1:DimName}, '${2:InsertBefore}', '${3:ElName}', '${4:N}');",    detail: 'Add element (Metadata procedure)' },
  { label: 'DimensionElementInsertDirect', snippet: "DimensionElementInsertDirect(${1:DimName}, '${2:InsertBefore}', '${3:ElName}', '${4:N}');", detail: 'Add element directly' },
  { label: 'DimensionElementDelete',       snippet: 'DimensionElementDelete(${1:DimName}, ${2:ElName});',  detail: 'Delete element' },
  { label: 'DimensionElementExists',       snippet: 'DimensionElementExists(${1:DimName}, ${2:ElName})',   detail: 'Returns 1 if element exists' },
  { label: 'DimensionElementComponentAdd', snippet: 'DimensionElementComponentAdd(${1:DimName}, ${2:Parent}, ${3:Child}, ${4:1});', detail: 'Add child to consolidation' },
  // Process control
  { label: 'ExecuteProcess',  snippet: "ExecuteProcess('${1:ProcessName}');",                       detail: 'Run another TI process (synchronous)' },
  { label: 'RunProcess',      snippet: "RunProcess('${1:ProcessName}')",                            detail: 'Run TI process in parallel, returns JobID' },
  { label: 'ItemSkip',        snippet: 'ItemSkip;',                                                 detail: 'Skip current data source record' },
  { label: 'ItemReject',      snippet: "ItemReject('${1:ErrorMessage}');",                          detail: 'Reject record and write to error log' },
  { label: 'ProcessBreak',    snippet: 'ProcessBreak;',                                             detail: 'Stop data processing, jump to Epilog' },
  { label: 'ProcessError',    snippet: 'ProcessError;',                                             detail: 'Immediately terminate process' },
  { label: 'ProcessQuit',     snippet: 'ProcessQuit;',                                              detail: 'Terminate process' },
  { label: 'ProcessRollback', snippet: 'ProcessRollback;',                                          detail: 'Rollback and restart process' },
  { label: 'ProcessExists',   snippet: "ProcessExists('${1:ProcessName}')",                         detail: 'Returns 1 if process exists' },
  // Control flow
  { label: 'If',    snippet: 'If(${1:condition});\n\t${2}\nEndIf;',                                 detail: 'Conditional block' },
  { label: 'While', snippet: 'While(${1:condition});\n\t${2}\nEnd;',                                detail: 'Loop while condition is true' },
  // Attributes
  { label: 'AttrPutN', snippet: "AttrPutN(${1:value}, '${2:DimName}', '${3:Element}', '${4:Attribute}');",  detail: 'Write numeric element attribute' },
  { label: 'AttrPutS', snippet: "AttrPutS('${1:value}', '${2:DimName}', '${3:Element}', '${4:Attribute}');", detail: 'Write string element attribute' },
  // Misc
  { label: 'ASCIIOutput', snippet: "ASCIIOutput('${1:filename.txt}', ${2:value});",                 detail: 'Write line to ASCII file' },
  { label: 'ASCIIInput',  snippet: "ASCIIInput('${1:filename.txt}', ${2:delimiter});",              detail: 'Read from ASCII file' },
  { label: 'GetProcessName',    snippet: 'GetProcessName()',                                        detail: 'Returns current process name' },
  { label: 'GetProcessErrorFilename', snippet: 'GetProcessErrorFilename',                           detail: 'Returns error log filename' },
  { label: 'Synchronized', snippet: "Synchronized('${1:lockName}');",                              detail: 'Serialize parallel process execution' },
]

const RULES_KEYWORDS = [
  { label: 'DB',      snippet: "DB('${1:cube}', ${2:elements})",                 detail: 'Get value from cube (Rules only)' },
  { label: 'SKIPCHECK', snippet: 'SKIPCHECK;',                                   detail: 'Skip zero-value feeders check' },
  { label: 'UNDEFVALS', snippet: 'UNDEFVALS;',                                   detail: 'Enable undefined cell values' },
  { label: 'FEEDER',  snippet: '${1:source} => ${2:target};',                    detail: 'Define a feeder' },
  { label: 'IF',      snippet: 'IF(${1:condition}, ${2:true_value}, ${3:false_value})', detail: 'Conditional expression (Rules)' },
  { label: 'ISLEAF',  snippet: 'ISLEAF',                                         detail: 'Returns 1 if current cell is a leaf' },
]

// ── Context detector ──────────────────────────────────────────────────────────
// Walk forward through text tracking nested calls and string state.
// Returns { fn, paramIdx } of the innermost function the cursor is inside, or null.

export function getCallContext(textBefore) {
  const stack = []   // [{ fn, commas }]
  let inStr  = false
  let strCh  = null

  for (let i = 0; i < textBefore.length; i++) {
    const ch = textBefore[i]

    if (inStr) {
      if (ch === strCh && textBefore[i - 1] !== '\\') inStr = false
      continue
    }

    if (ch === "'" || ch === '"') { inStr = true; strCh = ch; continue }

    if (ch === '(') {
      const fnMatch = textBefore.slice(0, i).match(/([A-Za-z_]\w*)\s*$/)
      stack.push({ fn: fnMatch ? fnMatch[1].toUpperCase() : null, commas: 0 })
    } else if (ch === ')') {
      stack.pop()
    } else if (ch === ',' && stack.length > 0) {
      stack[stack.length - 1].commas++
    }
  }

  if (!stack.length) return null
  const top = stack[stack.length - 1]
  return top.fn ? { fn: top.fn, paramIdx: top.commas } : null
}

// Resolve the parameter type for a given function + param index
function resolveParamType(catalog, fn, paramIdx) {
  const params = catalog[fn]
  if (!params) return null
  if (paramIdx < params.length) {
    const t = params[paramIdx]
    return t.endsWith('*') ? t.slice(0, -1) : t
  }
  // Repeating last type
  const last = params[params.length - 1]
  return last.endsWith('*') ? last.slice(0, -1) : null
}

// ── In-memory cache (30s cubes/dims, 60s cube-dims) ─────────────────────────
const _cache = new Map()
function _cached(key, ttlMs, fn) {
  const now  = Date.now()
  const hit  = _cache.get(key)
  if (hit && now - hit.t < ttlMs) return Promise.resolve(hit.v)
  return fn().then(v => { _cache.set(key, { v, t: Date.now() }); return v })
}

const enc = encodeURIComponent

async function fetchCubes(server) {
  return _cached(`cubes:${server}`, 30_000, async () => {
    const r = await fetch(`/api/cubes?server=${enc(server)}`)
    return r.ok ? r.json() : []
  })
}

async function fetchDims(server) {
  return _cached(`dims:${server}`, 30_000, async () => {
    const r = await fetch(`/api/dimensions?server=${enc(server)}`)
    return r.ok ? r.json() : []
  })
}

async function fetchCubeDims(server, cube) {
  return _cached(`cubedims:${server}:${cube}`, 60_000, async () => {
    const r = await fetch(`/api/cube/dimensions?server=${enc(server)}&cube=${enc(cube)}`)
    return r.ok ? r.json() : []
  })
}

// ── Provider factory ─────────────────────────────────────────────────────────

export function registerTM1Completions(monaco, language, catalog, keywords, getServer) {
  const CIK = monaco.languages.CompletionItemKind

  return monaco.languages.registerCompletionItemProvider(language, {
    triggerCharacters: ["'", '"', '(', ',', ' '],

    provideCompletionItems: async (model, position) => {
      const server = getServer()
      if (!server) return { suggestions: [] }

      const textBefore = model.getValueInRange({
        startLineNumber: 1, startColumn: 1,
        endLineNumber: position.lineNumber, endColumn: position.column,
      })

      const word  = model.getWordUntilPosition(position)
      const range = {
        startLineNumber: position.lineNumber, endLineNumber: position.lineNumber,
        startColumn: word.startColumn, endColumn: word.endColumn,
      }

      const ctx = getCallContext(textBefore)

      // ── Keyword/snippet suggestions (not inside a call) ───────────────────
      if (!ctx) {
        if (!word.word) return { suggestions: [] }
        const typed = word.word.toUpperCase()
        return {
          suggestions: keywords
            .filter(k => k.label.toUpperCase().startsWith(typed))
            .map(k => ({
              label:       k.label,
              kind:        CIK.Function,
              detail:      k.detail,
              insertText:  k.snippet,
              insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
              range,
            })),
        }
      }

      const paramType = resolveParamType(catalog, ctx.fn, ctx.paramIdx)
      if (!paramType) return { suggestions: [] }

      // ── Cube name parameter ───────────────────────────────────────────────
      if (paramType === 'cubename') {
        const cubes = await fetchCubes(server)

        // Offer full snippet expansion for cell-access functions
        const isExpandable = [
          'DB', 'CELLPUTN', 'CELLPUTS', 'CELLGETN', 'CELLGETS', 'CELLINCREMENTN',
          'CELLVALUEN', 'CELLVALUES',
        ].includes(ctx.fn)

        if (isExpandable) {
          const suggestions = await Promise.all(cubes.map(async cube => {
            const dims = await fetchCubeDims(server, cube)
            const dimStops = dims.map((d, i) => `\${${i + 1}:!${d}}`).join(', ')
            const detail = dims.length ? `${dims.length} dims: ${dims.join(', ')}` : 'No dimensions'

            return {
              label:       { label: cube, description: detail },
              kind:        CIK.Module,
              detail,
              documentation: { value: `**${cube}**\n\nDimensions (in order):\n${dims.map((d, i) => `${i + 1}. ${d}`).join('\n')}` },
              insertText:  dimStops ? `${cube}', ${dimStops}` : `${cube}'`,
              insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
              range,
              sortText:    cube,
            }
          }))
          return { suggestions }
        }

        return {
          suggestions: cubes.map(cube => ({
            label:      cube,
            kind:       CIK.Module,
            insertText: cube,
            range,
          })),
        }
      }

      // ── Dimension name parameter ──────────────────────────────────────────
      if (paramType === 'dimname') {
        const dims = await fetchDims(server)
        return {
          suggestions: dims.map(dim => ({
            label:      dim,
            kind:       CIK.Class,
            detail:     'Dimension',
            insertText: dim,
            range,
          })),
        }
      }

      return { suggestions: [] }
    },
  })
}

// ── Convenience registrations ─────────────────────────────────────────────────

export function registerRulesCompletions(monaco, getServer) {
  return registerTM1Completions(monaco, 'tm1rules', RULES_CATALOG, RULES_KEYWORDS, getServer)
}

export function registerTICompletions(monaco, getServer) {
  return registerTM1Completions(monaco, 'tm1ti', TI_CATALOG, TI_KEYWORDS, getServer)
}
