/**
 * useGridAppearance — per-grid display settings (row height, font size, zebra
 * striping, number format, consolidation emphasis), persisted to localStorage.
 *
 * Each grid mounts its own instance (loads the saved settings); the View editor
 * also reads numFormat to feed raw vs formatted values into its data pipelines.
 */

import { useState, useEffect, useCallback } from 'react'
import { themeBalham, colorSchemeDark, colorSchemeLight } from 'ag-grid-community'

const KEY = 'tm1-grid-appearance'
const DEFAULTS = { rowHeight: 'compact', fontSize: 12, zebra: true, numFormat: true, consEmphasis: true }

function load() {
  try { return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) || '{}') } } catch { return { ...DEFAULTS } }
}

export function useGridAppearance() {
  const [settings, setSettings] = useState(load)

  useEffect(() => {
    try { localStorage.setItem(KEY, JSON.stringify(settings)) } catch { /* storage unavailable */ }
  }, [settings])

  const patch = useCallback((key, value) => {
    setSettings(s => ({ ...s, [key]: value }))
  }, [])

  const makeTheme = useCallback((dark, headerHeight = 28) => {
    const base = dark ? themeBalham.withPart(colorSchemeDark) : themeBalham.withPart(colorSchemeLight)
    const rowHeight = settings.rowHeight === 'comfortable' ? 34 : 24
    return base.withParams({ fontSize: settings.fontSize, rowHeight, headerHeight })
  }, [settings.rowHeight, settings.fontSize])

  const rowStyle = useCallback((params) => {
    if (!settings.zebra) return undefined
    return (params.node?.rowIndex ?? 0) % 2 === 1 ? { background: 'rgba(127,127,127,0.07)' } : undefined
  }, [settings.zebra])

  return { settings, patch, makeTheme, rowStyle }
}