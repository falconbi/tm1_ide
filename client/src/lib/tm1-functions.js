// TM1 function catalog and Monaco autocomplete registration
import { formatRules } from '@/lib/formatters/rules-formatter.js'
import { loadSettings } from '@/lib/formatters/settings.js'
import { getNamingMap } from '@/lib/formatters/naming.js'
import { registerTM1Snippets } from '@/lib/tm1-snippets.js'
import { MDX_FUNCTIONS_FLAT, MDX_KEYWORDS } from '@/lib/tm1-mdx-catalog.js'
import { RULES_CATALOG, TI_CATALOG } from '@/lib/tm1-completion.js'
import { catalogEntry } from '@/lib/catalog-runtime.js'


// ── Monaco registration ───────────────────────────────────────────────────────

// getServer:  function that returns the currently connected server name or null
// getVersion: function that returns the connected server's product version (optional)
function registerTM1Completions(monaco, getServer, getVersion) {
  // ── Language registration + tokenizers ──────────────────────────────────────
  // Function-name highlighting is built from the real catalog (not a short
  // hand-picked list) so every Rules function gets the same 'type' token —
  // previously only ~10 names (DB, ATTRS, STET, ...) were ever highlighted.
  const rulesFnNames = Object.keys(RULES_CATALOG).sort((a, b) => b.length - a.length)
  const rulesFnPattern = new RegExp(`\\b(${rulesFnNames.join('|')})\\b`, 'i')

  monaco.languages.register({ id: 'tm1rules' })
  monaco.languages.setMonarchTokensProvider('tm1rules', {
    tokenizer: {
      root: [
        [/#.*/, 'comment'],
        [/\/\/.*/, 'comment'],
        [/'[^']*'/, 'string'],
        [/\b(SKIPCHECK|FEEDSTRINGS|FEEDERS|FEEDER|N:|C:|S:)\b/i, 'keyword'],
        [rulesFnPattern, 'type'],
        [/![a-zA-Z_][\w ]*/, 'variable'],
        [/\[([^\]]+)\]/, 'string'],
        [/[0-9]+(\.[0-9]+)?/, 'number'],
        [/[=>|,;()+\-*/]/, 'operator'],
      ]
    }
  })

  // Folding: #Region / #EndRegion blocks (PAW-style)
  monaco.languages.registerFoldingRangeProvider('tm1rules', {
    provideFoldingRanges(model, _context, _token) {
      const ranges = []
      const lineCount = model.getLineCount()
      const stack = []
      for (let line = 1; line <= lineCount; line++) {
        const text = model.getLineContent(line).trim()
        if (/^#Region\b/i.test(text)) {
          stack.push(line)
        } else if (/^#EndRegion\b/i.test(text)) {
          const start = stack.pop()
          if (start != null) {
            ranges.push({ start, end: line, kind: monaco.languages.FoldingRangeKind.Region })
          }
        }
      }
      return ranges
    }
  })

  // Go to Symbol: #Region blocks appear in Ctrl+Shift+O outline
  monaco.languages.registerDocumentSymbolProvider('tm1rules', {
    provideDocumentSymbols(model, _token) {
      const symbols = []
      const lineCount = model.getLineCount()
      const stack = []
      for (let line = 1; line <= lineCount; line++) {
        const text = model.getLineContent(line).trim()
        const match = text.match(/^#Region\s+(.*)$/i)
        if (match) {
          const name = match[1].trim() || 'Region'
          stack.push({ name, line })
        } else if (/^#EndRegion\b/i.test(text)) {
          const region = stack.pop()
          if (region) {
            symbols.push({
              name: region.name,
              kind: monaco.languages.SymbolKind.Namespace,
              range: new monaco.Range(region.line, 1, line, model.getLineMaxColumn(line)),
              selectionRange: new monaco.Range(region.line, 1, region.line, model.getLineMaxColumn(region.line)),
              children: [],
            })
          }
        }
      }
      // Close any unclosed regions at end of file
      while (stack.length) {
        const region = stack.pop()
        symbols.push({
          name: region.name,
          kind: monaco.languages.SymbolKind.Namespace,
          range: new monaco.Range(region.line, 1, lineCount, model.getLineMaxColumn(lineCount)),
          selectionRange: new monaco.Range(region.line, 1, region.line, model.getLineMaxColumn(region.line)),
          children: [],
        })
      }
      return symbols
    }
  })

  // Format Document: auto-format TM1 rules (token-aware engine)
  monaco.languages.registerDocumentFormattingEditProvider('tm1rules', {
    provideDocumentFormattingEdits(model, _options, _token) {
      const text = model.getValue()
      const settings = loadSettings()
      const { map: namingMap } = getNamingMap()
      const formatted = formatRules(text, settings.rules, namingMap)
      return [{ range: model.getFullModelRange(), text: formatted }]
    }
  })

  monaco.languages.registerDocumentRangeFormattingEditProvider('tm1rules', {
    provideDocumentRangeFormattingEdits(model, range, _options, _token) {
      const text = model.getValueInRange(range)
      const settings = loadSettings()
      const { map: namingMap } = getNamingMap()
      const formatted = formatRules(text, settings.rules, namingMap)
      return [{ range, text: formatted }]
    }
  })

  // Folding: IF/ENDIF, WHILE/END, FOR/NEXT blocks in TI
  monaco.languages.registerFoldingRangeProvider('tm1ti', {
    provideFoldingRanges(model, _context, _token) {
      const ranges = []
      const lineCount = model.getLineCount()
      const stack = [] // { type: 'if'|'while'|'for', line }
      for (let line = 1; line <= lineCount; line++) {
        const text = model.getLineContent(line).trim()
        if (/^IF\s*\(/i.test(text))          stack.push({ type: 'if',    line })
        else if (/^WHILE\s*\(/i.test(text))  stack.push({ type: 'while', line })
        else if (/^FOR\s+\w/i.test(text))    stack.push({ type: 'for',   line })
        else if (/^ENDIF\s*;?\s*$/i.test(text)) {
          const open = [...stack].reverse().find(s => s.type === 'if')
          if (open) { stack.splice(stack.lastIndexOf(open), 1); ranges.push({ start: open.line, end: line, kind: monaco.languages.FoldingRangeKind.Region }) }
        } else if (/^END\s*;?\s*$/i.test(text)) {
          const open = [...stack].reverse().find(s => s.type === 'while')
          if (open) { stack.splice(stack.lastIndexOf(open), 1); ranges.push({ start: open.line, end: line, kind: monaco.languages.FoldingRangeKind.Region }) }
        } else if (/^NEXT\s*(\(|\s*;)/i.test(text)) {
          const open = [...stack].reverse().find(s => s.type === 'for')
          if (open) { stack.splice(stack.lastIndexOf(open), 1); ranges.push({ start: open.line, end: line, kind: monaco.languages.FoldingRangeKind.Region }) }
        }
      }
      return ranges
    }
  })

  monaco.languages.register({ id: 'tm1ti' })
  monaco.languages.setMonarchTokensProvider('tm1ti', {
    tokenizer: {
      root: [
        [/#.*/, 'comment'],
        [/'[^']*'/, 'string'],
        [/\b(IF|ELSE|ELSEIF|ENDIF|WHILE|END|NEXT|FOR|BREAK)\b/i, 'keyword'],
        [/\b[A-Za-z_]\w*\s*(?=\()/, 'type'],
        [/[0-9]+(\.[0-9]+)?/, 'number'],
        [/[=><!|,;()+\-*/]/, 'operator'],
        [/[A-Za-z_]\w*/, 'variable'],
      ]
    }
  })

  monaco.languages.register({ id: 'tm1mdx' })
  monaco.languages.setMonarchTokensProvider('tm1mdx', {
    tokenizer: {
      root: [
        [/--.*/, 'comment'],
        [/'[^']*'/, 'string'],
        [/"[^"]*"/, 'string'],
        [/\[([^\]]*)\]/, 'variable'],
        [/\b(SELECT|FROM|WHERE|ON|ROWS|COLUMNS|AXIS|WITH|MEMBER|AS|SET|NON|EMPTY)\b/i, 'keyword'],
        [/\b(FILTER|CROSSJOIN|TOPCOUNT|BOTTOMCOUNT|ORDER|DESCENDANTS|ANCESTORS|NONEMPTY|INTERSECT|UNION|EXCEPT|GENERATE|EXTRACT|PERIODSTODATE|PARALLELPERIOD|LAG|LEAD)\b/i, 'type'],
        [/\b(TM1FILTERBYLEVEL|TM1FILTERBYPATTERN|TM1SORT|TM1MEMBER|TM1DRILLDOWNMEMBER|TM1DRILLDOWNLEVEL)\b/i, 'type'],
        [/\b(CURRENTMEMBER|PROPERTIES|CHILDREN|ANCESTORS|PARENT|NEXTMEMBER|PREVMEMBER|SIBLINGS|MEMBERS|ALLMEMBERS|DEFAULTMEMBER|FIRSTCHILD|LASTCHILD)\b/i, 'type'],
        [/[0-9]+(\.[0-9]+)?/, 'number'],
        [/[{}()\[\],.]/, 'operator'],
      ]
    }
  })

  // ── MDX context extractor ────────────────────────────────────────────────────
  function extractMDXContext(model, position) {
    const text = model.getValueInRange({
      startLineNumber: 1, startColumn: 1,
      endLineNumber: position.lineNumber, endColumn: position.column,
    })
    let depth = 0
    let parenPos = -1
    for (let i = text.length - 1; i >= 0; i--) {
      const ch = text[i]
      if (ch === ')') { depth++; continue }
      if (ch === '(') {
        if (depth === 0) { parenPos = i; break }
        depth--
      }
    }
    if (parenPos < 0) return null
    const match = text.slice(0, parenPos).match(/([A-Za-z][A-Za-z0-9_]*)$/)
    if (!match) return null
    const funcName = match[1].toUpperCase()
    let paramIndex = 0
    let d = 0
    for (let i = parenPos + 1; i < text.length; i++) {
      const ch = text[i]
      if (ch === '(') d++
      else if (ch === ')') d--
      else if (ch === ',' && d === 0) paramIndex++
    }
    return { funcName, paramIndex }
  }

  // ── MDX completion provider ──────────────────────────────────────────────────
  const MDX_FN_MAP = Object.fromEntries(MDX_FUNCTIONS_FLAT.map(f => [f.name.toUpperCase(), f]))

  monaco.languages.registerCompletionItemProvider('tm1mdx', {
    triggerCharacters: ['(', ','],
    provideCompletionItems: (model, position) => {
      const word  = model.getWordUntilPosition(position)
      const upper = word.word.toUpperCase()
      const range = {
        startLineNumber: position.lineNumber,
        endLineNumber:   position.lineNumber,
        startColumn:     word.startColumn,
        endColumn:       position.column,
      }

      const fnSuggestions = MDX_FUNCTIONS_FLAT
        .filter(f => !upper || f.name.toUpperCase().startsWith(upper))
        .map(f => ({
          label:           f.name,
          kind:            monaco.languages.CompletionItemKind.Function,
          detail:          f.signature,
          documentation:   { value: f.description },
          insertText:      f.template || f.name,
          insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
          range,
        }))

      const kwSuggestions = MDX_KEYWORDS
        .filter(k => !upper || k.startsWith(upper))
        .map(k => ({
          label:      k,
          kind:       monaco.languages.CompletionItemKind.Keyword,
          insertText: k,
          range,
        }))

      return { suggestions: [...fnSuggestions, ...kwSuggestions] }
    },
  })

  // ── MDX signature help provider ──────────────────────────────────────────────
  monaco.languages.registerSignatureHelpProvider('tm1mdx', {
    signatureHelpTriggerCharacters:   ['(', ','],
    signatureHelpRetriggerCharacters: [','],
    provideSignatureHelp: (model, position) => {
      const ctx = extractMDXContext(model, position)
      if (!ctx) return null
      const fn = MDX_FN_MAP[ctx.funcName]
      if (!fn || !fn.params?.length) return null
      return {
        value: {
          signatures: [{
            label:         fn.signature,
            documentation: fn.description,
            parameters:    fn.params.map(p => ({ label: p, documentation: p })),
          }],
          activeSignature: 0,
          activeParameter: Math.min(ctx.paramIndex, fn.params.length - 1),
        },
        dispose: () => {},
      }
    },
  })

  // ── TI variable completion — file-scope variables & parameters ─────────────
  // Scans the TI source for `name = value` assignments plus the Parameters /
  // Variables arrays in the #JSON_PROPERTIES block. Mirrors PA-Code's
  // TM1VariableCompletionProvider. Registers a SEPARATE provider on tm1ti so it
  // can't interfere with the function/arg provider above.
  function collectVariables(text) {
    const vars = new Map() // name → value (undefined if none)
    // Skip the #JSON_PROPERTIES block when scanning assignment lines
    const propsIdx = text.search(/#JSON_PROPERTIES/i)
    const codePart = propsIdx >= 0 ? text.slice(0, propsIdx) : text

    for (const line of codePart.split('\n')) {
      if (line.trimStart().startsWith('#')) continue
      // name = value ;   (avoid == comparisons and assignments inside strings)
      const m = /^\s*([A-Za-z_]\w*)\s*=\s*(.*?)\s*;?\s*$/.exec(line)
      if (m) {
        const value = (m[2] ?? '').trim()
        if (!vars.has(m[1])) vars.set(m[1], value || undefined)
      }
    }

    // Parameters / Variables arrays from the #JSON_PROPERTIES block
    if (propsIdx >= 0) {
      try {
        const props = JSON.parse(text.slice(propsIdx + '#JSON_PROPERTIES'.length).trim())
        for (const arr of ['Parameters', 'Variables']) {
          for (const p of props?.[arr] ?? []) {
            if (p?.Name && !vars.has(p.Name)) vars.set(p.Name, undefined)
          }
        }
      } catch { /* malformed JSON properties — ignore */ }
    }
    return [...vars.entries()].map(([name, value]) => ({ name, value }))
  }

  monaco.languages.registerCompletionItemProvider('tm1ti', {
    triggerCharacters: [],
    provideCompletionItems: (model, position) => {
      const lineUpTo = model.getLineContent(position.lineNumber).slice(0, position.column - 1)
      // skip inside a quoted string (odd number of quotes on the line so far)
      if ((lineUpTo.match(/'/g) ?? []).length % 2 !== 0) return { suggestions: [] }
      // skip on comment lines
      if (lineUpTo.trimStart().startsWith('#')) return { suggestions: [] }
      // only complete at a word boundary
      const word = model.getWordUntilPosition(position)
      const typed = word.word
      const vars = collectVariables(model.getValue())
      if (!vars.length || !typed) return { suggestions: [] }

      const range = {
        startLineNumber: position.lineNumber, endLineNumber: position.lineNumber,
        startColumn: word.startColumn, endColumn: word.endColumn,
      }
      const lower = typed.toLowerCase()
      return {
        suggestions: vars
          .filter(v => !lower || v.name.toLowerCase().includes(lower))
          .map(v => ({
            label:      v.name,
            kind:       monaco.languages.CompletionItemKind.Variable,
            detail:     v.value ? `= ${v.value}` : 'TI variable',
            documentation: v.value
              ? { value: `Process variable\n\n\`${v.name} = ${v.value}\`` }
              : { value: 'Process variable / parameter' },
            insertText: v.name,
            sortText:   '0_' + v.name,
            range,
          })),
      }
    },
  })

  // ── Hover providers ────────────────────────────────────────────────────────
  function hoverMarkdown(name, entry, paramList) {
    const lines = [`**${name}**`]
    if (entry.description) lines.push('', entry.description)
    if (paramList?.length) {
      lines.push('', '**Parameters:**')
      paramList.forEach(p => lines.push(`- \`${p}\``))
    }
    if (entry.returnType && entry.returnType !== 'void')
      lines.push('', `**Returns:** \`${entry.returnType}\``)
    if (entry.compat === 'v12')
      lines.push('', '**Compat:** TM1 Database 12 (PA 3+) only')
    else if (entry.compat === 'v11')
      lines.push('', '**Compat:** V11 classic only — removed in TM1 Database 12')
    if (entry.deprecated)
      lines.push('', `> ⚠ Deprecated: ${entry.deprecated}`)
    return { value: lines.join('\n') }
  }

  function catalogHover(lang, baseCatalog, model, position) {
    const word = model.getWordAtPosition(position)
    if (!word) return null
    const upper = word.word.toUpperCase()
    const entry = catalogEntry(lang, upper, baseCatalog)
    if (!entry) return null
    return {
      range:    new monaco.Range(position.lineNumber, word.startColumn, position.lineNumber, word.endColumn),
      contents: [hoverMarkdown(upper, entry, entry.params ?? [])],
    }
  }

  monaco.languages.registerHoverProvider('tm1rules', {
    provideHover: (model, pos) => catalogHover('rules', RULES_CATALOG, model, pos),
  })

  monaco.languages.registerHoverProvider('tm1ti', {
    provideHover: (model, pos) => catalogHover('ti', TI_CATALOG, model, pos),
  })

  monaco.languages.registerHoverProvider('tm1mdx', {
    provideHover: (model, position) => {
      const word = model.getWordAtPosition(position)
      if (!word) return null
      const fn = MDX_FN_MAP[word.word.toUpperCase()]
      if (!fn) return null
      const lines = [`**${fn.name}**`, '', fn.description]
      if (fn.params?.length) { lines.push('', '**Parameters:**'); fn.params.forEach(p => lines.push(`- ${p}`)) }
      lines.push('', `\`${fn.signature}\``)
      return {
        range:    new monaco.Range(position.lineNumber, word.startColumn, position.lineNumber, word.endColumn),
        contents: [{ value: lines.join('\n') }],
      }
    },
  })

  registerTM1Snippets(monaco)
  console.log(`TM1 autocomplete registered — ${Object.keys(RULES_CATALOG).length} rules, ${Object.keys(TI_CATALOG).length} TI functions`)
}

// ── Register custom Monaco theme with user-defined colours ────────────────────

import { buildMonacoTheme, loadColourSettings, applyColourTheme } from '@/lib/formatters/colours.js'

function bgIsLight(hex) {
  const h = (hex ?? '#282a36').replace('#', '')
  const r = parseInt(h.slice(0, 2), 16)
  const g = parseInt(h.slice(2, 4), 16)
  const b = parseInt(h.slice(4, 6), 16)
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.5
}

export function registerTM1Theme(monaco, dark) {
  let cs = loadColourSettings()
  // Auto-correct if the stored colour theme doesn't match the UI dark/light mode
  const colourIsLight = bgIsLight(cs.background)
  if (!dark && !colourIsLight) cs = applyColourTheme('light', cs)
  else if (dark && colourIsLight) cs = applyColourTheme('dracula', cs)
  const editorTheme = dark ? 'vs-dark' : 'vs'
  const themeDef = buildMonacoTheme(editorTheme, cs)
  monaco.editor.defineTheme('tm1-custom', themeDef)
  monaco.editor.setTheme('tm1-custom')
}

export { registerTM1Completions }
