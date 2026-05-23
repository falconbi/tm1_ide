// ── Format Settings Persistence ────────────────────────────────────────────────
// localStorage-backed settings for TM1 Rules and TI Process formatters.

import { PRESETS } from './presets.js'

const STORAGE_KEY = 'tm1-ide-format-settings'

export const DEFAULT_SETTINGS = {
  version: 1,
  rules: {
    preset: 'standard',
    expressionFormatter: null,
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
    preset: 'standard',
    indentStyle: 'spaces2',
    keywordCase: 'asIs',
    functionCallSpacing: 'standard',
    commaSpacing: 'single',
    operatorSpacing: 'standard',
    lineWrap: 'off',
    preserveMetadataBlocks: true,
    alignAssignments: false,
  },
  editor: {
    fontFamily: 'Geist Mono',
    fontSize: 13,
    lineHeight: 1.5,
    monacoTheme: 'vs-dark',
    uiAccent: 'blue',
  },
}

/**
 * Load settings from localStorage, merging with defaults.
 * @returns {object}
 */
export function loadSettings() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw)
      return deepMerge(DEFAULT_SETTINGS, parsed)
    }
  } catch {}
  return structuredClone(DEFAULT_SETTINGS)
}

/**
 * Save settings to localStorage.
 * @param {object} settings
 */
export function saveSettings(settings) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings))
  } catch {}
}

/**
 * Apply a preset to the current settings.
 * @param {string} presetName — 'compact', 'standard', 'expanded'
 * @param {'rules'|'ti'} type
 * @returns {object} updated settings
 */
export function applyPreset(presetName, type, currentSettings = null) {
  const settings = currentSettings ?? loadSettings()
  const preset = PRESETS[presetName]
  if (!preset) return settings

  return {
    ...settings,
    [type]: {
      ...settings[type],
      ...preset[type],
      preset: presetName,
    },
  }
}

/**
 * Deep merge two objects (shallow clone top level, deep merge nested).
 * @param {object} defaults
 * @param {object} overrides
 * @returns {object}
 */
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

/**
 * Reset all settings to defaults.
 */
export function resetAllSettings() {
  localStorage.removeItem(STORAGE_KEY)
  return structuredClone(DEFAULT_SETTINGS)
}

/**
 * Get a human-readable description of current settings differences from default.
 * Useful for the UI "Custom" preset indicator.
 */
export function isCustomPreset(settings, type) {
  const presetName = settings[type].preset
  if (!presetName || presetName === 'custom') return true
  const preset = PRESETS[presetName]
  if (!preset) return true

  // Compare current settings against the preset
  const presetValues = preset[type]
  for (const key of Object.keys(presetValues)) {
    if (settings[type][key] !== presetValues[key]) {
      return true
    }
  }
  return false
}
