// ── TM1 Snippet data ──────────────────────────────────────────────────────────
// code uses Monaco snippet syntax: ${N:placeholder}, ${0} = final cursor.
// The panel strips markers before insertion; autocomplete uses them as tab stops.

import { loadCustomSnippets } from './custom-snippets'
import { getNamingMap } from './formatters/naming.js'
import TM1_CATALOG from '@shared/tm1-function-catalog.json'
import { ALL_SNIPPETS } from './tm1-snippets-data.js'

// Every catalog function already has an autocomplete entry (with signature +
// snippet) via tm1-completion.js, so the snippet library must only supply
// STRUCTURAL templates (loops, IF/ELSE, datasource setup, ...) — not bare
// single-function calls like DIMIX() which would duplicate the autocomplete.
const CATALOG_NAMES = new Set(Object.keys(TM1_CATALOG).map(n => n.toUpperCase()))
const isCatalogFunction = (s) =>
  CATALOG_NAMES.has(s.label.replace(/\(\)$/, '').trim().toUpperCase()) ||
  CATALOG_NAMES.has(s.trigger.toUpperCase())

// ── Function reference (lookup panel) ─────────────────────────────────────────
// The panel is a technical reference of EVERY TM1 function, grouped by family,
// plus the structural templates (which stay insertable).

function categorizeFunction(name) {
  const u = String(name).toUpperCase()
  if (/^CELL/.test(u)) return 'Cell'
  if (/^CUBE/.test(u)) return 'Cube'
  if (/^DIM/.test(u)) return 'Dimension'
  if (/^EL/.test(u)) return 'Element'
  if (/^ATTR/.test(u)) return 'Attribute'
  if (/^SUB/.test(u)) return 'Subset'
  if (/^VIEW/.test(u)) return 'View'
  if (/^PROCESS/.test(u)) return 'Process'
  if (/^CHORE/.test(u)) return 'Chore'
  if (/SECURITY/.test(u)) return 'Security'
  if (/^ASCII|OUTPUT|INPUT|FILE|OPEN/.test(u)) return 'File I/O'
  if (/^STR|^CHAR|^CODE|^SCAN|^SUBST|^UPPER|^LOWER|^LONG|^SHORT|^FILL|^NUMBER|^STRING|^DAY|^MONTH|^YEAR|^TODAY|^NOW|^TIMST|^DATE/.test(u)) return 'Text & Date'
  if (/^ABS|^ROUND|^INT|^MOD|^SIGN|^SQRT|^MAX|^MIN|^LOG|^EXP|^POWER|^DIV/.test(u)) return 'Math'
  if (/^PICKLIST/.test(u)) return 'Picklist'
  return 'Other'
}

export function getFunctionRef(language) {
  const funcs = []
  const naming = getNamingMap().map
  for (const [name, entry] of Object.entries(TM1_CATALOG)) {
    if (entry.language !== language && entry.language !== 'both') continue
    const params = entry.params ?? []
    const official = naming[name.toLowerCase()] ?? name
    funcs.push({
      trigger:   name.toLowerCase(),
      label:     official,
      description: entry.description ?? '',
      category:  categorizeFunction(official),
      language,
      signature: params.length ? `${official}(${params.join(', ')})` : `${official}()`,
      code:      params.length
        ? `${official}(${params.map((p, i) => `\${${i + 1}:${p.replace(/[*?]$/, '')}}`).join(', ')})`
        : `${official}()`,
      isFunction: true,
    })
  }
  const templates = ALL_SNIPPETS.filter(s => (s.language === language || s.language === 'both') && !isCatalogFunction(s))
  return [...funcs, ...templates]
}

export function getSnippets(language) {
  // Panel is a reference list — show everything (including single-function
  // snippets). Only the autocomplete provider dedupes against the catalog.
  return ALL_SNIPPETS.filter(s => s.language === language || s.language === 'both')
}

// ── Monaco registration ───────────────────────────────────────────────────────

let _registered = false

export function registerTM1Snippets(monaco) {
  if (_registered) return
  _registered = true

  const langMap = { tm1rules: 'rules', tm1ti: 'ti' }

  Object.entries(langMap).forEach(([langId, langKey]) => {
    monaco.languages.registerCompletionItemProvider(langId, {
      provideCompletionItems: (model, position) => {
        const word = model.getWordUntilPosition(position)
        const trigger = word.word.toLowerCase()
        if (!trigger) return { suggestions: [] }

        const range = {
          startLineNumber: position.lineNumber, endLineNumber: position.lineNumber,
          startColumn: word.startColumn,        endColumn: word.endColumn,
        }

        const allForLang = [
          ...ALL_SNIPPETS.filter(s => (s.language === langKey || s.language === 'both') && !isCatalogFunction(s)),
          ...loadCustomSnippets().filter(s => s.language === langKey),
        ]

        const suggestions = allForLang
          .filter(s => s.trigger.startsWith(trigger) || s.label.toLowerCase().startsWith(trigger))
          .map(s => ({
            label:           s.label,
            kind:            monaco.languages.CompletionItemKind.Snippet,
            detail:          s.category,
            documentation:   { value: `**${s.label}**\n\n${s.description}` },
            insertText:      s.code,
            insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
            sortText:        `z_${s.trigger}`,
            range,
          }))

        return { suggestions }
      },
    })
  })
}
