// ── Catalog entry schema ──────────────────────────────────────────────────────
// SINGLE SOURCE OF TRUTH: shared/tm1-function-catalog.json (repo root) — one entry
// per TM1 Rules/TI function, covering both languages. Every consumer (this
// file's RULES_CATALOG/TI_CATALOG split, core/rules-lint.js, core/ti-lint.js,
// ti-validator.js's isBuiltInTM1Function, ti-interpreter.js's simulator,
// tm1-snippets.js, naming.js's casing dictionary) derives from this JSON —
// do not hand-add a function name anywhere else. See CLAUDE.md "TM1 Function
// Catalog" section for the update workflow and the automated live-validation
// script (tools/validate-catalog.js).
import { getRulesCatalog, getTICatalog } from '@/lib/catalog-runtime'
import { compatAvailable } from '@/lib/tm1-version.js'
import { useStore } from '@/store'
import TM1_CATALOG from '@shared/tm1-function-catalog.json'
// Each entry: { language, params, returnType, description, compat, deprecated, isStatement }
// language:    'rules'|'ti'|'both' — which language(s) this function is valid in
// params:      string[] — param type tags for arg-count validation and context completions
//              Types: 'cubename'|'dimname'|'element'|'attribute'|'subset'|'hiername'|'value'|'n'|'string'|...
//              '*' suffix on the LAST tag = variadic (1-or-more repeats).
//              '?' suffix on the LAST tag = optional (0-or-1 of that single arg,
//              e.g. SubsetCreate's AsTemporary flag) — NOT variadic/unbounded.
// returnType:  'numeric'|'string'|'void'|'any'
// compat:      'both'|'v11'|'v12'   — v12 = TM1 Database 12 / PA 3+ only; v11 = classic TM1 11 only (removed in v12)
// deprecated:  string | null         — shown as amber squiggle in editor; null = not deprecated
// isStatement: boolean               — true = cannot be used in an expression / assignment

function filterCatalog(lang) {
  const out = {}
  for (const [name, entry] of Object.entries(TM1_CATALOG)) {
    if (entry.language === lang || entry.language === 'both') {
      const { language, ...rest } = entry
      out[name] = rest
    }
  }
  return out
}

const RULES_CATALOG = filterCatalog('rules')
const TI_CATALOG    = filterCatalog('ti')


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
  { label: 'FEEDERS', snippet: 'FEEDERS;',                                       detail: 'Marks the beginning of the FEEDERS section' },
  { label: 'UNDEFVALS', snippet: 'UNDEFVALS;',                                   detail: 'Enable undefined cell values' },
  { label: 'FEEDER',  snippet: '${1:source} => ${2:target};',                    detail: 'Define a feeder' },
  { label: 'IF',      snippet: 'IF(${1:condition}, ${2:true_value}, ${3:false_value})', detail: 'Conditional expression (Rules)' },
  { label: 'ISLEAF',  snippet: 'ISLEAF',                                         detail: 'Returns 1 if current cell is a leaf' },
  { label: '#Region',    snippet: '#Region ${1:name}',                           detail: 'Collapsible region marker (folding)' },
  { label: '#EndRegion', snippet: '#EndRegion',                                  detail: 'End of a region block' },
]

// ── Context detector ──────────────────────────────────────────────────────────
// Walk forward through text tracking nested calls and string state.
// Returns { fn, paramIdx } of the innermost function the cursor is inside, or null.

export function getCallContext(textBefore) {
  const stack = []   // [{ fn, commas }]
  let inStr  = false
  let strCh  = null
  let inComment = false

  for (let i = 0; i < textBefore.length; i++) {
    const ch = textBefore[i]

    if (inComment) { if (ch === '\n') inComment = false; continue }
    if (inStr) {
      if (ch === strCh && textBefore[i - 1] !== '\\') inStr = false
      continue
    }

    if (ch === '#') { inComment = true; continue }
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
// Strips the trailing '*' (variadic) or '?' (optional single arg) marker so
// callers get the plain type tag ('cubename', 'value', etc.) either way.
function bareParamTag(t) {
  return (t.endsWith('*') || t.endsWith('?')) ? t.slice(0, -1) : t
}

function resolveParamType(catalog, fn, paramIdx) {
  const entry = catalog[fn]
  if (!entry) return null
  const params = entry.params ?? []
  if (paramIdx < params.length) return bareParamTag(params[paramIdx])
  const last = params[params.length - 1]
  // Past the declared params: only a variadic ('*') tail can extend further —
  // an optional ('?') trailing arg is capped at exactly one occurrence.
  return last?.endsWith('*') ? bareParamTag(last) : null
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
const authFetch = (url) => fetch(url, { headers: { 'x-ide-token': localStorage.getItem('tm1-token') ?? '' } })

async function fetchCubes(server) {
  return _cached(`cubes:${server}`, 30_000, async () => {
    const r = await authFetch(`/api/cubes?server=${enc(server)}`)
    return r.ok ? r.json() : []
  })
}

async function fetchDims(server) {
  return _cached(`dims:${server}`, 30_000, async () => {
    const r = await authFetch(`/api/dimensions?server=${enc(server)}`)
    return r.ok ? r.json() : []
  })
}

async function fetchCubeDims(server, cube) {
  return _cached(`cubedims:${server}:${cube}`, 60_000, async () => {
    const r = await authFetch(`/api/cube/dimensions?server=${enc(server)}&cube=${enc(cube)}`)
    return r.ok ? r.json() : []
  })
}

async function fetchElements(server, dim) {
  return _cached(`elements:${server}:${dim}`, 60_000, async () => {
    const r = await authFetch(`/api/elements?server=${enc(server)}&dimension=${enc(dim)}`)
    return r.ok ? r.json() : []
  })
}

async function fetchAttributes(server, dim) {
  return _cached(`attrs:${server}:${dim}`, 60_000, async () => {
    const r = await authFetch(`/api/dimension/attributes?server=${enc(server)}&dimension=${enc(dim)}`)
    return r.ok ? r.json() : []
  })
}

async function fetchSubsets(server, dim) {
  return _cached(`subsets:${server}:${dim}`, 30_000, async () => {
    const r = await authFetch(`/api/subsets?server=${enc(server)}&dimension=${enc(dim)}`)
    return r.ok ? r.json() : []
  })
}

// Returns true if textBefore ends inside an unclosed quoted string
// (ignores # comments, which may contain apostrophes like "Budget's").
function isInsideString(textBefore) {
  let inStr = false, strCh = null, inComment = false
  for (let i = 0; i < textBefore.length; i++) {
    const ch = textBefore[i]
    if (inComment) { if (ch === '\n') inComment = false; continue }
    if (inStr) {
      if (ch === strCh && textBefore[i - 1] !== '\\') inStr = false
      continue
    }
    if (ch === '#') { inComment = true; continue }
    if (ch === "'" || ch === '"') { inStr = true; strCh = ch; continue }
  }
  return inStr
}

// Returns true if the cursor is inside a rules area block — ['Elem', 'Elem'] = N:
// Tracks [ / ] depth outside of quoted strings and # comments.
function isInsideRulesArea(text) {
  let inStr = false, strCh = null, depth = 0, inComment = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (inComment) { if (ch === '\n') inComment = false; continue }
    if (inStr) {
      if (ch === strCh) inStr = false
      continue
    }
    if (ch === "'" || ch === '"') { inStr = true; strCh = ch; continue }
    if (ch === '#') { inComment = true; continue }
    if (ch === '[') depth++
    else if (ch === ']') depth = Math.max(0, depth - 1)
  }
  return depth > 0
}

// Same quote-aware mode as the TI provider: 'close' if the opening quote is already
// typed (insert name + closing quote), 'wrap' otherwise (insert 'name').
function areaQuoteMode(model, position, word) {
  if (word.startColumn <= 1) return 'wrap'
  const prev = model.getValueInRange({
    startLineNumber: position.lineNumber, startColumn: word.startColumn - 1,
    endLineNumber:   position.lineNumber, endColumn:   word.startColumn,
  })
  return (prev === "'" || prev === '"') ? 'close' : 'wrap'
}

// True if there is already a closing quote right after the cursor — in that case
// an in-quote completion must NOT append another one (e.g. editing 'Pension Pct').
function quoteAfterCursor(model, position) {
  const next = model.getValueInRange({
    startLineNumber: position.lineNumber, startColumn: position.column,
    endLineNumber:   position.lineNumber, endColumn:   position.column + 1,
  })
  return next === "'" || next === '"'
}

// Range extended back to cover a leading '#' if the typed word is preceded by one
// (so '#Region' completions replace the '#' too, not just 'Region').
function hashRangeFor(model, position, word, range) {
  if (word.startColumn <= 1) return range
  const prev = model.getValueInRange({
    startLineNumber: position.lineNumber, startColumn: word.startColumn - 1,
    endLineNumber:   position.lineNumber, endColumn:   word.startColumn,
  })
  if (prev === '#') return { ...range, startColumn: word.startColumn - 1 }
  return range
}

// Returns the string value of the Nth argument of the innermost unclosed call
// (ignores # comments, which may contain apostrophes like "Budget's").
function extractStringArg(textBefore, argIndex) {
  const stack = []
  let inStr = false, strCh = null, inComment = false
  for (let i = 0; i < textBefore.length; i++) {
    const ch = textBefore[i]
    if (inComment) { if (ch === '\n') inComment = false; continue }
    if (inStr) {
      if (ch === strCh && textBefore[i - 1] !== '\\') inStr = false
      continue
    }
    if (ch === '#') { inComment = true; continue }
    if (ch === "'" || ch === '"') { inStr = true; strCh = ch; continue }
    if (ch === '(') stack.push(i)
    else if (ch === ')') stack.pop()
  }
  if (!stack.length) return null
  const inside = textBefore.slice(stack[stack.length - 1] + 1)

  let args = [], current = '', depth = 0
  inStr = false; strCh = null; inComment = false
  for (const ch of inside) {
    if (inComment) { if (ch === '\n') inComment = false; current += ch; continue }
    if (inStr) {
      if (ch === strCh) inStr = false
      current += ch
      continue
    }
    if (ch === '#') { inComment = true; current += ch; continue }
    if (ch === "'" || ch === '"') { inStr = true; strCh = ch; current += ch; continue }
    if (ch === '(' || ch === '[') { depth++; current += ch }
    else if ((ch === ')' || ch === ']') && depth > 0) { depth--; current += ch }
    else if (ch === ',' && depth === 0) { args.push(current.trim()); current = '' }
    else { current += ch }
  }
  args.push(current.trim())

  const arg = args[argIndex]
  if (!arg) return null
  const m = arg.match(/^['"](.+)['"]$/)
  return m ? m[1] : null
}

// Functions where param 0 is cubename and params 1+ are element positions
const CUBE_FIRST_FNS = new Set([
  'DB', 'CELLVALUEN', 'CELLVALUES', 'CELLGETN', 'CELLGETS',
  'CELLPUTN', 'CELLPUTS', 'CELLINCREMENTN',
])

// ── Snippet/signature builders (generic, driven by catalog param tags) ────────

function buildCatalogSignature(name, entry) {
  const params = entry.params ?? []
  if (!params.length) return entry.isStatement ? `${name};` : `${name}()`
  return `${name}(${params.join(', ')})${entry.returnType && entry.returnType !== 'void' ? ' : ' + entry.returnType : ''}`
}

function buildCatalogSnippet(name, entry) {
  const params = entry.params ?? []
  if (!params.length) return entry.isStatement ? `${name};` : `${name}()`
  const stops = params.map((p, i) => `\${${i + 1}:${bareParamTag(p)}}`).join(', ')
  return `${name}(${stops})`
}

// Function + keyword name suggestions filtered by the typed prefix — used both at
// statement level (!ctx) and inside generic argument positions (condition/value/n).
// `hashRange` (optional) covers a leading '#' before the word so '#Region' inserts
// cleanly instead of producing '##Region'.
function functionNameSuggestions({ typed, keywords, catalogNow, version, range, hashRange, monaco, CIK }) {
  const keywordNames = new Set(keywords.map(k => k.label.toUpperCase()))
  const fromKeywords = keywords
    .filter(k => k.label.toUpperCase().replace(/^#/, '').startsWith(typed))
    .map(k => ({
      label:       k.label,
      kind:        CIK.Function,
      detail:      k.detail,
      insertText:  k.snippet,
      insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
      range:       k.label.startsWith('#') && hashRange ? hashRange : range,
    }))
  const fromCatalog = Object.entries(catalogNow)
    .filter(([name, entry]) =>
      !keywordNames.has(name) && name.startsWith(typed) &&
      compatAvailable(entry?.compat ?? 'both', version))
    .map(([name, entry]) => ({
      label:       name,
      kind:        CIK.Function,
      detail:      buildCatalogSignature(name, entry),
      documentation: { value: entry.description ?? '' },
      insertText:  buildCatalogSnippet(name, entry),
      insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
      range,
    }))
  return [...fromKeywords, ...fromCatalog]
}

// ── Provider factory ─────────────────────────────────────────────────────────

export function registerTM1Completions(monaco, language, catalog, keywords, getContext) {
  const CIK = monaco.languages.CompletionItemKind

  return monaco.languages.registerCompletionItemProvider(language, {
    triggerCharacters: ["'", '"', '(', ',', ' ', '='],

    provideCompletionItems: async (model, position) => {
      // getContext may return a bare server string, or { server, cube?, version? }
      const rawCtx  = typeof getContext === 'function' ? getContext() : null
      const server  = typeof rawCtx === 'string' ? rawCtx : (rawCtx?.server ?? null)
      const cube    = rawCtx && typeof rawCtx === 'object' ? (rawCtx.cube ?? null) : null
      const version = rawCtx && typeof rawCtx === 'object' ? (rawCtx.version ?? null) : null
      if (!server) return { suggestions: [] }
      const catalogNow = typeof catalog === 'function' ? catalog() : catalog

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

      // ── Rules area completion — typing element names inside ['Area', ...] ──
      // Areas aren't inside a function call, so ctx is null here. TM1 matches area
      // elements to cube dimensions BY NAME, not by position — order is the
      // developer's choice, and dimensions you don't list are unconstrained (all
      // elements). So we offer every element across all the cube's dims. If a name
      // exists in more than one dimension (ambiguous — TM1 will reject it), we
      // offer it as Dim:ElementName so it compiles.
      if (language === 'tm1rules' && cube && !ctx && isInsideRulesArea(textBefore)) {
        const dims = await fetchCubeDims(server, cube)
        if (!dims.length) return { suggestions: [] }
        const byName = new Map() // lowercased name → Set of dims it appears in
        const elementsByDim = {}
        for (const dim of dims) {
          const elements = await fetchElements(server, dim)
          elementsByDim[dim] = elements
          for (const el of elements) {
            const name = el.Name ?? el.name
            if (!name || name.startsWith('}')) continue
            const key = name.toLowerCase()
            if (!byName.has(key)) byName.set(key, new Set())
            byName.get(key).add(dim)
          }
        }
        const mode = areaQuoteMode(model, position, word)
        const suggestions = []
        let count = 0
        for (const dim of dims) {
          for (const el of elementsByDim[dim] ?? []) {
            const name = el.Name ?? el.name
            if (!name || name.startsWith('}')) continue
            const ambiguous = (byName.get(name.toLowerCase())?.size ?? 0) > 1
            const label = ambiguous ? `${dim}:${name}` : name
            suggestions.push({
              label,
              kind:       CIK.Value,
              detail:     ambiguous ? `Element — ${dim} (ambiguous — prefixed)` : `Element — ${dim}`,
              insertText: mode === 'close' ? `${label}'` : `'${label}'`,
              range,
              sortText:   name,
            })
            count++
            if (count >= 250) return { suggestions }
          }
        }
        return { suggestions }
      }

      // ── Area-type qualifier — right after ['Area'] = ───────────────────────
      // TM1 rule areas always take one of exactly three type qualifiers
      // (N: numeric, C: consolidated, S: string) — offer them as tab-selectable
      // completions instead of requiring them to be typed out.
      if (language === 'tm1rules' && !ctx && /\]\s+=\s+$/.test(textBefore)) {
        const AREA_TYPES = [
          { t: 'N', detail: 'Numeric' },
          { t: 'C', detail: 'Consolidated' },
          { t: 'S', detail: 'String' },
        ]
        return {
          suggestions: AREA_TYPES.map(({ t, detail }) => ({
            label:      `${t}:`,
            kind:       CIK.EnumMember,
            detail,
            insertText: `${t}: `,
            range,
          })),
        }
      }

      // ── Keyword/snippet suggestions (not inside a call) ───────────────────
      // Two sources, merged: the hand-tuned `keywords` list (nicer placeholder
      // names for common functions) plus every OTHER function in the full
      // catalog (generic snippet built from its param tags) so nothing in the
      // catalog is invisible to plain name-typing, just less nicely templated.
      if (!ctx) {
        if (!word.word) return { suggestions: [] }
        const typed = word.word.toUpperCase()
        return { suggestions: functionNameSuggestions({ typed, keywords, catalogNow, version, range, hashRange: hashRangeFor(model, position, word, range), monaco, CIK }) }
      }

      const paramType = resolveParamType(catalogNow, ctx.fn, ctx.paramIdx)
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
          // Full expansion must produce a syntactically complete call —
          // opening quote (only if not already typed), the cube name,
          // closing quote, every dimension as a tab-stop, and the closing ).
          const inQuote = isInsideString(textBefore)
          const suggestions = await Promise.all(cubes.map(async cube => {
            const dims = await fetchCubeDims(server, cube)
            const dimStops = dims.map((d, i) => `\${${i + 1}:!${d}}`).join(', ')
            const detail = dims.length ? `${dims.length} dims: ${dims.join(', ')}` : 'No dimensions'
            const cubePart = inQuote ? `${cube}'` : `'${cube}'`

            return {
              label:       { label: cube, description: detail },
              kind:        CIK.Module,
              detail,
              documentation: { value: `**${cube}**\n\nDimensions (in order):\n${dims.map((d, i) => `${i + 1}. ${d}`).join('\n')}` },
              insertText:  dimStops ? `${cubePart}, ${dimStops})` : `${cubePart})`,
              insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
              range,
              sortText:    cube,
            }
          }))
          return { suggestions }
        }

        const inQuoteCub = isInsideString(textBefore)
        const hasCloseCub = quoteAfterCursor(model, position)
        return {
          suggestions: cubes.map(cube => ({
            label:      cube,
            kind:       CIK.Module,
            insertText: inQuoteCub ? (hasCloseCub ? cube : `${cube}'`) : `'${cube}'`,
            range,
          })),
        }
      }

      // ── Dimension name parameter ──────────────────────────────────────────
      if (paramType === 'dimname') {
        const dims = await fetchDims(server)
        const inQuote = isInsideString(textBefore)
        const hasClose = quoteAfterCursor(model, position)
        return {
          suggestions: dims.map(dim => ({
            label:      dim,
            kind:       CIK.Class,
            detail:     'Dimension',
            insertText: inQuote ? (hasClose ? dim : `${dim}'`) : `'${dim}'`,
            range,
          })),
        }
      }

      // ── Element parameter ─────────────────────────────────────────────────
      if (paramType === 'element') {
        const inQuote = isInsideString(textBefore)
        let targetDim = null

        if (CUBE_FIRST_FNS.has(ctx.fn)) {
          const cubeName = extractStringArg(textBefore, 0)
          if (cubeName) {
            const dims = await fetchCubeDims(server, cubeName)
            targetDim = dims[ctx.paramIdx - 1] ?? null
          }
        } else {
          // dim-first functions (ATTRN, ELPAR, etc.) — dim name is at arg 0
          targetDim = extractStringArg(textBefore, 0)
        }

        if (!targetDim) return { suggestions: [] }

        if (inQuote) {
          const ELEMENT_TYPE_LABEL = { N: 'Numeric', C: 'Consolidated', S: 'String' }
          const elements = await fetchElements(server, targetDim)
          const hasClose = quoteAfterCursor(model, position)
          return {
            suggestions: elements.map(el => ({
              label:      el.Name,
              kind:       CIK.Value,
              detail:     ELEMENT_TYPE_LABEL[el.Type] ?? el.Type,
              insertText: hasClose ? el.Name : `${el.Name}'`,
              range,
            })),
          }
        }

        // Not inside a quote — this is an expression position, so offer both
        // the quick !DimName reference AND every catalog function (ATTRS,
        // ELPAR, etc.) so a nested call can be composed here instead of a
        // plain element name.
        const typed = word.word.toUpperCase()
        const fnSuggestions = Object.entries(catalogNow)
          .filter(([name, entry]) => name.startsWith(typed) && compatAvailable(entry?.compat ?? 'both', version))
          .map(([name, entry]) => ({
            label:       name,
            kind:        CIK.Function,
            detail:      buildCatalogSignature(name, entry),
            documentation: { value: entry.description ?? '' },
            insertText:  buildCatalogSnippet(name, entry),
            insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
            sortText:    `1_${name}`,
            range,
          }))
        return {
          suggestions: [{
            label:      `!${targetDim}`,
            kind:       CIK.Variable,
            detail:     `Current element — ${targetDim}`,
            insertText: `!${targetDim}`,
            range,
            sortText:   '0_!',
          }, ...fnSuggestions],
        }
      }

      // ── Attribute name parameter ──────────────────────────────────────────
      if (paramType === 'attribute') {
        const entry  = catalogNow[ctx.fn]
        const dimIdx = entry?.params?.findIndex(p => bareParamTag(p) === 'dimname') ?? -1
        const targetDim = dimIdx >= 0 ? extractStringArg(textBefore, dimIdx) : null
        if (!targetDim) return { suggestions: [] }

        const inQuote = isInsideString(textBefore)
        const attrs = await fetchAttributes(server, targetDim)
        const hasClose = quoteAfterCursor(model, position)
        return {
          suggestions: attrs.map(a => ({
            label:      a.name,
            kind:       CIK.Property,
            detail:     a.type,
            insertText: inQuote ? (hasClose ? a.name : `${a.name}'`) : `'${a.name}'`,
            range,
          })),
        }
      }

      // ── Subset name parameter ─────────────────────────────────────────────
      if (paramType === 'subset') {
        const entry  = catalogNow[ctx.fn]
        const dimIdx = entry?.params?.findIndex(p => bareParamTag(p) === 'dimname') ?? -1
        const targetDim = dimIdx >= 0 ? extractStringArg(textBefore, dimIdx) : null
        if (!targetDim) return { suggestions: [] }

        const inQuote = isInsideString(textBefore)
        const subsets = await fetchSubsets(server, targetDim)
        const hasClose = quoteAfterCursor(model, position)
        return {
          suggestions: subsets.map(s => ({
            label:      s.Name,
            kind:       CIK.Struct,
            detail:     s.Expression ? 'MDX subset' : 'Static subset',
            insertText: inQuote ? (hasClose ? s.Name : `${s.Name}'`) : `'${s.Name}'`,
            range,
          })),
        }
      }

      // ── Generic parameter (condition / value / n / string / unknown) ──────
      // Not inside a quoted string → this is an expression position, so offer
      // function + keyword completions (e.g. typing ELPAR inside IF(ELPAR…)).
      if (!isInsideString(textBefore)) {
        if (word.word) {
          return { suggestions: functionNameSuggestions({ typed: word.word.toUpperCase(), keywords, catalogNow, version, range, hashRange: hashRangeFor(model, position, word, range), monaco, CIK }) }
        }
      }

      return { suggestions: [] }
    },
  })
}

// ── Signature help (single provider, catalog-driven — replaces the old
//    second implementation that used to live in tm1-functions.js) ────────────

export function registerTM1SignatureHelp(monaco, language, catalog) {
  return monaco.languages.registerSignatureHelpProvider(language, {
    signatureHelpTriggerCharacters:   ['(', ','],
    signatureHelpRetriggerCharacters: [','],
    provideSignatureHelp: (model, position) => {
      const textBefore = model.getValueInRange({
        startLineNumber: 1, startColumn: 1,
        endLineNumber: position.lineNumber, endColumn: position.column,
      })
      const ctx = getCallContext(textBefore)
      if (!ctx) return null
      const catalogNow = typeof catalog === 'function' ? catalog() : catalog
      const entry = catalogNow[ctx.fn]
      if (!entry || !entry.params?.length) return null

      return {
        value: {
          signatures: [{
            label:         buildCatalogSignature(ctx.fn, entry),
            documentation: entry.description ?? '',
            parameters:    entry.params.map(p => ({ label: bareParamTag(p) })),
          }],
          activeSignature: 0,
          activeParameter: Math.min(ctx.paramIdx, entry.params.length - 1),
        },
        dispose: () => {},
      }
    },
  })
}

// ── Convenience registrations ─────────────────────────────────────────────────

export { RULES_CATALOG, TI_CATALOG }

// Monaco registers providers globally; registering on every editor mount (or tab
// switch) accumulates copies and duplicates every suggestion. Each provider is
// registered exactly ONCE app-wide; the context (server / cube / version) is read
// from the store's active tab at query time, so it always matches the focused
// editor.
let _rulesRegistered = false
let _tiRegistered = false
let _rulesSigRegistered = false
let _tiSigRegistered = false

const activeTabContext = (withCube) => {
  const s = useStore.getState()
  const tab = s.tabs.find(t => t.id === s.activeTab)
  if (!tab) return { server: s.server ?? null, version: s.serverVersion ?? null }
  return withCube
    ? { server: tab.server ?? s.server, cube: tab.cube, version: s.serverVersion ?? null }
    : { server: tab.server ?? s.server, version: s.serverVersion ?? null }
}

export function registerRulesCompletions(monaco) {
  if (!_rulesSigRegistered) {
    _rulesSigRegistered = true
    registerTM1SignatureHelp(monaco, 'tm1rules', () => getRulesCatalog() ?? RULES_CATALOG)
  }
  if (_rulesRegistered) return
  _rulesRegistered = true
  return registerTM1Completions(monaco, 'tm1rules', () => getRulesCatalog() ?? RULES_CATALOG, RULES_KEYWORDS, () => activeTabContext(true))
}

export function registerTICompletions(monaco) {
  if (!_tiSigRegistered) {
    _tiSigRegistered = true
    registerTM1SignatureHelp(monaco, 'tm1ti', () => getTICatalog() ?? TI_CATALOG)
  }
  if (_tiRegistered) return
  _tiRegistered = true
  return registerTM1Completions(monaco, 'tm1ti', () => getTICatalog() ?? TI_CATALOG, TI_KEYWORDS, () => activeTabContext(false))
}
