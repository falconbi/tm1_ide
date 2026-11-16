// ── Format Presets ────────────────────────────────────────────────────────────
// Built-in presets for Rules and TI formatters.

export const PRESETS = {
  compact: {
    name: 'Compact',
    description: 'Minimal spacing, dense lines',
    rules: {
      indentStyle: 'spaces2',
      areaPrefixSpacing: 'none',
      functionCallSpacing: 'compact',
      commaSpacing: 'none',
      semicolonSpacing: 'none',
      operatorSpacing: 'compact',
      alignEquals: false,
      lineWrap: 'off',
      wrapIndent: 'hanging',
      ifFormatting: 'inline',
      capitalization: 'asIs',
      preserveComments: true,
      preserveStrings: true,
    },
    ti: {
      indentStyle: 'spaces2',
      keywordCase: 'asIs',
      functionCallSpacing: 'compact',
      commaSpacing: 'none',
      operatorSpacing: 'compact',
      lineWrap: 'off',
      preserveMetadataBlocks: true,
      alignAssignments: false,
    },
  },

  standard: {
    name: 'Standard',
    description: 'Balanced readability',
    rules: {
      indentStyle: 'spaces2',
      areaPrefixSpacing: 'single',
      functionCallSpacing: 'standard',
      commaSpacing: 'single',
      semicolonSpacing: 'none',
      operatorSpacing: 'standard',
      alignEquals: false,
      lineWrap: 'off',
      wrapIndent: 'hanging',
      ifFormatting: 'inline',
      capitalization: 'asIs',
      preserveComments: true,
      preserveStrings: true,
    },
    ti: {
      indentStyle: 'spaces2',
      keywordCase: 'asIs',
      functionCallSpacing: 'standard',
      commaSpacing: 'single',
      operatorSpacing: 'standard',
      lineWrap: 'off',
      preserveMetadataBlocks: true,
      alignAssignments: false,
    },
  },

  expanded: {
    name: 'Expanded',
    description: 'Generous spacing, multi-line',
    rules: {
      indentStyle: 'spaces2',
      areaPrefixSpacing: 'single',
      functionCallSpacing: 'expanded',
      commaSpacing: 'single',
      semicolonSpacing: 'none',
      operatorSpacing: 'standard',
      alignEquals: true,
      lineWrap: '120',
      wrapIndent: 'hanging',
      ifFormatting: 'multiline',
      capitalization: 'asIs',
      preserveComments: true,
      preserveStrings: true,
    },
    ti: {
      indentStyle: 'spaces2',
      keywordCase: 'asIs',
      functionCallSpacing: 'expanded',
      commaSpacing: 'single',
      operatorSpacing: 'standard',
      lineWrap: '120',
      preserveMetadataBlocks: true,
      alignAssignments: false,
    },
  },
  'tm1-verbose': {
    name: 'TM1 Verbose',
    description: 'Expression-aware: each string argument on its own line',
    rules: {
      indentStyle: 'spaces2',
      areaPrefixSpacing: 'single',
      functionCallSpacing: 'standard',
      commaSpacing: 'single',
      semicolonSpacing: 'none',
      operatorSpacing: 'standard',
      alignEquals: false,
      lineWrap: 'off',
      wrapIndent: 'hanging',
      ifFormatting: 'multiline',
      capitalization: 'asIs',
      preserveComments: true,
      preserveStrings: true,
      expressionFormatter: 'tm1-verbose',
    },
    ti: {
      indentStyle: 'spaces2',
      keywordCase: 'asIs',
      functionCallSpacing: 'standard',
      commaSpacing: 'single',
      operatorSpacing: 'standard',
      lineWrap: 'off',
      preserveMetadataBlocks: true,
      alignAssignments: false,
    },
  },

  'tm1-structured': {
    name: 'TM1 Structured',
    description: 'Expression-aware: consecutive string arguments grouped on one line',
    rules: {
      indentStyle: 'spaces2',
      areaPrefixSpacing: 'single',
      functionCallSpacing: 'standard',
      commaSpacing: 'single',
      semicolonSpacing: 'none',
      operatorSpacing: 'standard',
      alignEquals: false,
      lineWrap: 'off',
      wrapIndent: 'hanging',
      ifFormatting: 'multiline',
      capitalization: 'asIs',
      preserveComments: true,
      preserveStrings: true,
      expressionFormatter: 'tm1-structured',
    },
    ti: {
      indentStyle: 'spaces2',
      keywordCase: 'asIs',
      functionCallSpacing: 'standard',
      commaSpacing: 'single',
      operatorSpacing: 'standard',
      lineWrap: 'off',
      preserveMetadataBlocks: true,
      alignAssignments: false,
    },
  },
}

/**
 * Get a preset by name.
 * @param {string} name — 'compact', 'standard', 'expanded'
 * @returns {object|null}
 */
export function getPreset(name) {
  return PRESETS[name] ?? null
}

/**
 * List all preset names and descriptions.
 * @returns {Array<{id:string, name:string, description:string}>}
 */
export function listPresets() {
  return Object.entries(PRESETS).map(([id, p]) => ({
    id,
    name: p.name,
    description: p.description,
  }))
}
