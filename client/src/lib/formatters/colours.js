// ── Syntax Colour Settings ────────────────────────────────────────────────────
// Per-token colour customization for TM1 Rules and TI Process editors.
// Saved to localStorage, importable/exportable as JSON.

const STORAGE_KEY = 'tm1-ide-colour-settings'

// Default colour scheme — inspired by standard dark IDE palettes
export const DEFAULT_COLOURS = {
  version: 1,
  rules: {
    area_prefix:   '#ff79c6',  // pink — N:, C:, S:
    keyword:       '#8be9fd',  // cyan — IF, ELSE, ENDIF, FEEDERS, SKIPCHECK, STET
    function:      '#50fa7b',  // green — DB, ATTRS, ATTRN, CellGetN, etc.
    string:        '#f1fa8c',  // yellow — 'cube name', 'member'
    dim_var:       '#bd93f9',  // purple — !organization, !Month
    number:        '#ffb86c',  // orange — 100, -0.5
    comment:       '#6272a4',  // muted blue-grey — // ..., # ...
    operator:      '#ff79c6',  // pink — =, <>, >=, =>, +, -, *, /
    punctuation:   '#f8f8f2',  // near-white — ( ) [ ] { } , ;
    directive:     '#ff79c6',  // pink — #Region, #EndRegion
    default:       '#f8f8f2',  // near-white — everything else
  },
  ti: {
    keyword:       '#8be9fd',
    function:      '#50fa7b',
    string:        '#f1fa8c',
    number:        '#ffb86c',
    comment:       '#6272a4',
    operator:      '#ff79c6',
    punctuation:   '#f8f8f2',
    variable:      '#bd93f9',  // purple — vValue, pParam
    metadata:      '#ff79c6',  // pink — #****Begin: Metadata
    default:       '#f8f8f2',
  },
}

/**
 * Load colour settings from localStorage, merging with defaults.
 * @returns {object}
 */
export function loadColourSettings() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw)
      return deepMerge(DEFAULT_COLOURS, parsed)
    }
  } catch {}
  return structuredClone(DEFAULT_COLOURS)
}

/**
 * Save colour settings to localStorage.
 * @param {object} colours
 */
export function saveColourSettings(colours) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(colours))
  } catch {}
}

/**
 * Reset all colours to defaults.
 */
export function resetColourSettings() {
  localStorage.removeItem(STORAGE_KEY)
  return structuredClone(DEFAULT_COLOURS)
}

/**
 * Export colour settings as JSON string.
 * @returns {string}
 */
export function exportColourSettings() {
  const settings = loadColourSettings()
  return JSON.stringify(settings, null, 2)
}

/**
 * Import colour settings from JSON string.
 * @param {string} json
 * @returns {boolean} success
 */
export function importColourSettings(json) {
  try {
    const parsed = JSON.parse(json)
    if (parsed && parsed.rules && parsed.ti) {
      saveColourSettings(parsed)
      return true
    }
  } catch {}
  return false
}

/**
 * Generate a Monaco theme JSON object from colour settings.
 * @param {string} baseTheme — 'vs' | 'vs-dark' | 'hc-black'
 * @param {object} colourSettings
 * @returns {object} Monaco theme definition
 */
export function buildMonacoTheme(baseTheme, colourSettings) {
  const isDark = baseTheme !== 'vs'
  const bg = isDark ? '#282a36' : '#ffffff'
  const fg = isDark ? '#f8f8f2' : '#1e1e1e'
  const lineHighlight = isDark ? '#44475a' : '#f5f5f5'
  const selection = isDark ? '#44475a' : '#add6ff'

  const r = colourSettings.rules

  return {
    base: baseTheme,
    inherit: true,
    rules: [
      // Area prefixes
      { token: 'area_prefix.tm1rules', foreground: r.area_prefix },
      // Keywords
      { token: 'keyword.tm1rules', foreground: r.keyword },
      { token: 'keyword.feeders.tm1rules', foreground: r.keyword },
      { token: 'keyword.skipcheck.tm1rules', foreground: r.keyword },
      { token: 'keyword.stet.tm1rules', foreground: r.keyword },
      // Functions / identifiers that are known TM1 functions
      { token: 'function.tm1rules', foreground: r.function },
      { token: 'identifier.tm1rules', foreground: r.function },
      // Strings
      { token: 'string.tm1rules', foreground: r.string },
      // Dimension variables
      { token: 'dim_var.tm1rules', foreground: r.dim_var },
      // Numbers
      { token: 'number.tm1rules', foreground: r.number },
      // Comments
      { token: 'comment.tm1rules', foreground: r.comment },
      // Operators
      { token: 'operator.tm1rules', foreground: r.operator },
      // Punctuation
      { token: 'punctuation.tm1rules', foreground: r.punctuation },
      // Directives
      { token: 'directive.tm1rules', foreground: r.directive },
      // Default
      { token: '', foreground: r.default },
    ],
    colors: {
      'editor.background': bg,
      'editor.foreground': fg,
      'editorLineNumber.foreground': isDark ? '#6272a4' : '#858585',
      'editorLineNumber.activeForeground': isDark ? '#f8f8f2' : '#1e1e1e',
      'editor.selectionBackground': selection,
      'editor.lineHighlightBackground': lineHighlight,
      'editorCursor.foreground': fg,
    },
  }
}

// ── Helper ──────────────────────────────────────────────────────────────────

function deepMerge(defaults, overrides) {
  const result = structuredClone(defaults)
  for (const key of Object.keys(overrides)) {
    if (overrides[key] !== null && typeof overrides[key] === 'object' && !Array.isArray(overrides[key])) {
      result[key] = deepMerge(defaults[key] ?? {}, overrides[key])
    } else {
      result[key] = overrides[key]
    }
  }
  return result
}
