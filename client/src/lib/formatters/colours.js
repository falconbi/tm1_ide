// ── Syntax Colour Settings ────────────────────────────────────────────────────
// Per-token colour customization for TM1 Rules and TI Process editors.
// Saved to localStorage, importable/exportable as JSON.

const STORAGE_KEY = 'tm1-ide-colour-settings'

// ── Preset themes ─────────────────────────────────────────────────────────────

export const COLOUR_THEMES = [
  {
    id: 'dracula',
    name: 'Dracula',
    background: '#282a36',
    rules: {
      area_prefix:  '#ff79c6',
      keyword:      '#8be9fd',
      mdx_keyword:  '#ff79c6',
      function:     '#50fa7b',
      string:       '#f1fa8c',
      dim_var:      '#bd93f9',
      number:       '#ffb86c',
      comment:      '#6272a4',
      operator:     '#ff79c6',
      punctuation:  '#f8f8f2',
      directive:    '#ff79c6',
      default:      '#f8f8f2',
    },
    ti: {
      keyword:      '#8be9fd',
      function:     '#50fa7b',
      string:       '#f1fa8c',
      number:       '#ffb86c',
      comment:      '#6272a4',
      operator:     '#ff79c6',
      punctuation:  '#f8f8f2',
      variable:     '#bd93f9',
      metadata:     '#ff79c6',
      default:      '#f8f8f2',
    },
  },
  {
    id: 'vscode-dark',
    name: 'VS Code Dark+',
    background: '#1e1e1e',
    rules: {
      area_prefix:  '#c586c0',
      keyword:      '#569cd6',
      mdx_keyword:  '#c586c0',
      function:     '#dcdcaa',
      string:       '#ce9178',
      dim_var:      '#9cdcfe',
      number:       '#b5cea8',
      comment:      '#6a9955',
      operator:     '#d4d4d4',
      punctuation:  '#d4d4d4',
      directive:    '#c586c0',
      default:      '#d4d4d4',
    },
    ti: {
      keyword:      '#569cd6',
      function:     '#dcdcaa',
      string:       '#ce9178',
      number:       '#b5cea8',
      comment:      '#6a9955',
      operator:     '#d4d4d4',
      punctuation:  '#d4d4d4',
      variable:     '#9cdcfe',
      metadata:     '#c586c0',
      default:      '#d4d4d4',
    },
  },
  {
    id: 'monokai',
    name: 'Monokai',
    background: '#272822',
    rules: {
      area_prefix:  '#f92672',
      keyword:      '#f92672',
      mdx_keyword:  '#f92672',
      function:     '#a6e22e',
      string:       '#e6db74',
      dim_var:      '#66d9e8',
      number:       '#ae81ff',
      comment:      '#75715e',
      operator:     '#f8f8f2',
      punctuation:  '#f8f8f2',
      directive:    '#f92672',
      default:      '#f8f8f2',
    },
    ti: {
      keyword:      '#f92672',
      function:     '#a6e22e',
      string:       '#e6db74',
      number:       '#ae81ff',
      comment:      '#75715e',
      operator:     '#f8f8f2',
      punctuation:  '#f8f8f2',
      variable:     '#66d9e8',
      metadata:     '#f92672',
      default:      '#f8f8f2',
    },
  },
  {
    id: 'one-dark',
    name: 'One Dark',
    background: '#282c34',
    rules: {
      area_prefix:  '#c678dd',
      keyword:      '#c678dd',
      mdx_keyword:  '#c678dd',
      function:     '#61afef',
      string:       '#98c379',
      dim_var:      '#e06c75',
      number:       '#d19a66',
      comment:      '#5c6370',
      operator:     '#abb2bf',
      punctuation:  '#abb2bf',
      directive:    '#c678dd',
      default:      '#abb2bf',
    },
    ti: {
      keyword:      '#c678dd',
      function:     '#61afef',
      string:       '#98c379',
      number:       '#d19a66',
      comment:      '#5c6370',
      operator:     '#abb2bf',
      punctuation:  '#abb2bf',
      variable:     '#e06c75',
      metadata:     '#c678dd',
      default:      '#abb2bf',
    },
  },
  {
    id: 'nord',
    name: 'Nord',
    background: '#2e3440',
    rules: {
      area_prefix:  '#81a1c1',
      keyword:      '#81a1c1',
      mdx_keyword:  '#81a1c1',
      function:     '#88c0d0',
      string:       '#a3be8c',
      dim_var:      '#b48ead',
      number:       '#d08770',
      comment:      '#616e88',
      operator:     '#d8dee9',
      punctuation:  '#d8dee9',
      directive:    '#81a1c1',
      default:      '#d8dee9',
    },
    ti: {
      keyword:      '#81a1c1',
      function:     '#88c0d0',
      string:       '#a3be8c',
      number:       '#d08770',
      comment:      '#616e88',
      operator:     '#d8dee9',
      punctuation:  '#d8dee9',
      variable:     '#b48ead',
      metadata:     '#81a1c1',
      default:      '#d8dee9',
    },
  },
  {
    id: 'solarized-dark',
    name: 'Solarized Dark',
    background: '#002b36',
    rules: {
      area_prefix:  '#268bd2',
      keyword:      '#268bd2',
      mdx_keyword:  '#268bd2',
      function:     '#859900',
      string:       '#2aa198',
      dim_var:      '#6c71c4',
      number:       '#d33682',
      comment:      '#586e75',
      operator:     '#93a1a1',
      punctuation:  '#93a1a1',
      directive:    '#268bd2',
      default:      '#93a1a1',
    },
    ti: {
      keyword:      '#268bd2',
      function:     '#859900',
      string:       '#2aa198',
      number:       '#d33682',
      comment:      '#586e75',
      operator:     '#93a1a1',
      punctuation:  '#93a1a1',
      variable:     '#6c71c4',
      metadata:     '#268bd2',
      default:      '#93a1a1',
    },
  },
  {
    id: 'gruvbox',
    name: 'Gruvbox',
    background: '#282828',
    rules: {
      area_prefix:  '#fb4934',
      keyword:      '#fb4934',
      mdx_keyword:  '#fb4934',
      function:     '#b8bb26',
      string:       '#fabd2f',
      dim_var:      '#d3869b',
      number:       '#fe8019',
      comment:      '#928374',
      operator:     '#ebdbb2',
      punctuation:  '#ebdbb2',
      directive:    '#fb4934',
      default:      '#ebdbb2',
    },
    ti: {
      keyword:      '#fb4934',
      function:     '#b8bb26',
      string:       '#fabd2f',
      number:       '#fe8019',
      comment:      '#928374',
      operator:     '#ebdbb2',
      punctuation:  '#ebdbb2',
      variable:     '#d3869b',
      metadata:     '#fb4934',
      default:      '#ebdbb2',
    },
  },
  {
    id: 'github-dark',
    name: 'GitHub Dark',
    background: '#0d1117',
    rules: {
      area_prefix:  '#ff7b72',
      keyword:      '#ff7b72',
      mdx_keyword:  '#ff7b72',
      function:     '#d2a8ff',
      string:       '#a5d6ff',
      dim_var:      '#79c0ff',
      number:       '#79c0ff',
      comment:      '#8b949e',
      operator:     '#c9d1d9',
      punctuation:  '#c9d1d9',
      directive:    '#ff7b72',
      default:      '#c9d1d9',
    },
    ti: {
      keyword:      '#ff7b72',
      function:     '#d2a8ff',
      string:       '#a5d6ff',
      number:       '#79c0ff',
      comment:      '#8b949e',
      operator:     '#c9d1d9',
      punctuation:  '#c9d1d9',
      variable:     '#79c0ff',
      metadata:     '#ff7b72',
      default:      '#c9d1d9',
    },
  },
  {
    id: 'tokyo-night',
    name: 'Tokyo Night',
    background: '#1a1b26',
    rules: {
      area_prefix:  '#bb9af7',
      keyword:      '#bb9af7',
      mdx_keyword:  '#bb9af7',
      function:     '#7aa2f7',
      string:       '#9ece6a',
      dim_var:      '#ff9e64',
      number:       '#ff9e64',
      comment:      '#565f89',
      operator:     '#a9b1d6',
      punctuation:  '#a9b1d6',
      directive:    '#bb9af7',
      default:      '#a9b1d6',
    },
    ti: {
      keyword:      '#bb9af7',
      function:     '#7aa2f7',
      string:       '#9ece6a',
      number:       '#ff9e64',
      comment:      '#565f89',
      operator:     '#a9b1d6',
      punctuation:  '#a9b1d6',
      variable:     '#ff9e64',
      metadata:     '#bb9af7',
      default:      '#a9b1d6',
    },
  },
  {
    id: 'light',
    name: 'Light',
    background: '#ffffff',
    rules: {
      area_prefix:  '#af00db',
      keyword:      '#0000ff',
      mdx_keyword:  '#af00db',
      function:     '#795e26',
      string:       '#a31515',
      dim_var:      '#001080',
      number:       '#098658',
      comment:      '#008000',
      operator:     '#000000',
      punctuation:  '#000000',
      directive:    '#af00db',
      default:      '#000000',
    },
    ti: {
      keyword:      '#0000ff',
      function:     '#795e26',
      string:       '#a31515',
      number:       '#098658',
      comment:      '#008000',
      operator:     '#000000',
      punctuation:  '#000000',
      variable:     '#001080',
      metadata:     '#af00db',
      default:      '#000000',
    },
  },
  {
    id: 'solarized-light',
    name: 'Solarized Light',
    background: '#fdf6e3',
    rules: {
      area_prefix:  '#268bd2',
      keyword:      '#268bd2',
      mdx_keyword:  '#268bd2',
      function:     '#859900',
      string:       '#2aa198',
      dim_var:      '#6c71c4',
      number:       '#d33682',
      comment:      '#93a1a1',
      operator:     '#657b83',
      punctuation:  '#657b83',
      directive:    '#268bd2',
      default:      '#657b83',
    },
    ti: {
      keyword:      '#268bd2',
      function:     '#859900',
      string:       '#2aa198',
      number:       '#d33682',
      comment:      '#93a1a1',
      operator:     '#657b83',
      punctuation:  '#657b83',
      variable:     '#6c71c4',
      metadata:     '#268bd2',
      default:      '#657b83',
    },
  },
  {
    id: 'github-light',
    name: 'GitHub Light',
    background: '#ffffff',
    rules: {
      area_prefix:  '#cf222e',
      keyword:      '#cf222e',
      mdx_keyword:  '#cf222e',
      function:     '#8250df',
      string:       '#0a3069',
      dim_var:      '#0550ae',
      number:       '#0550ae',
      comment:      '#6e7781',
      operator:     '#24292f',
      punctuation:  '#24292f',
      directive:    '#cf222e',
      default:      '#24292f',
    },
    ti: {
      keyword:      '#cf222e',
      function:     '#8250df',
      string:       '#0a3069',
      number:       '#0550ae',
      comment:      '#6e7781',
      operator:     '#24292f',
      punctuation:  '#24292f',
      variable:     '#0550ae',
      metadata:     '#cf222e',
      default:      '#24292f',
    },
  },
  {
    id: 'one-light',
    name: 'One Light',
    background: '#fafafa',
    rules: {
      area_prefix:  '#e45649',
      keyword:      '#e45649',
      mdx_keyword:  '#e45649',
      function:     '#4078f2',
      string:       '#50a14f',
      dim_var:      '#986801',
      number:       '#986801',
      comment:      '#a0a1a7',
      operator:     '#383a42',
      punctuation:  '#383a42',
      directive:    '#e45649',
      default:      '#383a42',
    },
    ti: {
      keyword:      '#e45649',
      function:     '#4078f2',
      string:       '#50a14f',
      number:       '#986801',
      comment:      '#a0a1a7',
      operator:     '#383a42',
      punctuation:  '#383a42',
      variable:     '#986801',
      metadata:     '#e45649',
      default:      '#383a42',
    },
  },
]

// ── Default colour scheme (Dracula) ───────────────────────────────────────────
export const DEFAULT_COLOURS = {
  version: 1,
  theme: 'dracula',
  background: '#282a36',
  rules: { ...COLOUR_THEMES[0].rules },
  ti:    { ...COLOUR_THEMES[0].ti },
}

/**
 * Return a fresh colourSettings object with the named theme applied.
 * Preserves any fields not covered by the theme.
 * @param {string} themeId
 * @param {object} current — existing colourSettings to merge into
 * @returns {object}
 */
export function applyColourTheme(themeId, current) {
  const theme = COLOUR_THEMES.find(t => t.id === themeId)
  if (!theme) return current
  return {
    ...current,
    theme: theme.id,
    background: theme.background,
    rules: { ...theme.rules },
    ti:    { ...theme.ti },
  }
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
  const bg = colourSettings.background ?? (isDark ? '#282a36' : '#ffffff')
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
      // MDX editor tokens
      { token: 'keyword.tm1mdx',  foreground: r.mdx_keyword ?? r.keyword },
      { token: 'type.tm1mdx',     foreground: r.function },
      { token: 'variable.tm1mdx', foreground: r.dim_var },
      { token: 'string.tm1mdx',   foreground: r.string },
      { token: 'number.tm1mdx',   foreground: r.number },
      { token: 'comment.tm1mdx',  foreground: r.comment },
      { token: 'operator.tm1mdx', foreground: r.operator },
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
      // Diff editor — vivid green/red so +/- lines pop clearly
      'diffEditor.insertedLineBackground':  isDark ? '#1a3a1a' : '#d4f7d4',
      'diffEditor.removedLineBackground':   isDark ? '#3a1a1a' : '#ffd4d4',
      'diffEditor.insertedTextBackground':  isDark ? '#2a5a2a' : '#a8e6a8',
      'diffEditor.removedTextBackground':   isDark ? '#5a2a2a' : '#f0a0a0',
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
