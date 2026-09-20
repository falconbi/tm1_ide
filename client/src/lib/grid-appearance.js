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
const DEFAULTS = { rowHeight: 'compact', fontSize: 12, zebra: true, numFormat: true, accent: '#2563eb', headerTint: true, headerBold: true }

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
    // accent drives headers, selection and focus; a faint tint of it becomes the header background
    const accent = /^#[0-9a-fA-F]{6}$/.test(settings.accent) ? settings.accent : '#2563eb'
    return base.withParams({
      fontSize: settings.fontSize,
      rowHeight,
      headerHeight,
      accentColor: accent,
      ...(settings.headerTint ? { headerBackgroundColor: `${accent}1f` } : {}),
      ...(settings.headerBold ? { headerFontWeight: '600' } : {}),
      inputFocusBorder: accent,
      selectedRowBackgroundColor: `${accent}26`,
      oddRowBackgroundColor: settings.zebra ? 'rgba(127,127,127,0.07)' : 'transparent',
    })
  }, [settings.rowHeight, settings.fontSize, settings.accent, settings.zebra, settings.headerTint, settings.headerBold])

  // Bump when a visual setting that needs a grid redraw changes (row height,
  // font size, accent) — AG Grid won't re-apply these by itself.
  const refreshKey = `${settings.rowHeight}-${settings.fontSize}-${settings.accent}-${settings.headerTint}-${settings.headerBold}`

  return { settings, patch, makeTheme, refreshKey }
}