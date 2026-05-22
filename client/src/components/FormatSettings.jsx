import { useState, useMemo, useCallback } from 'react'
import { X, RotateCcw, Save, Download, Upload, Plus, Trash2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { loadSettings, saveSettings, applyPreset, resetAllSettings, isCustomPreset, DEFAULT_SETTINGS } from '@/lib/formatters/settings.js'
import { getNamingMap, updateNamingDictionary, resetNamingDictionary, exportNamingDictionary, importNamingDictionary, IBM_DEFAULTS } from '@/lib/formatters/naming.js'
import { formatRules } from '@/lib/formatters/rules-formatter.js'
import { PRESETS, listPresets } from '@/lib/formatters/presets.js'
import { loadColourSettings, saveColourSettings, resetColourSettings, exportColourSettings, importColourSettings, DEFAULT_COLOURS } from '@/lib/formatters/colours.js'

// ── Sample code for live preview ──────────────────────────────────────────────

const SAMPLE_RULES = `[#Region Revenue]
['Gross Revenue'] = N: DB('Sales', !organization, !Channel, !product, !Month, !Year, 'Gross Revenue', !Version);
['Indirect COGS'] = N: IF(DB('Supply Chain', !organization, !Channel, !product, !Month, !Year, 'Units Sold', !Version) <> 0, DB('Supply Chain', !organization, !Channel, !product, !Month, !Year, 'Indirect Costs', !Version), CONTINUE);
['Net Revenue'] = N: ['Gross Revenue'] - ['Indirect COGS'];
#EndRegion

FEEDERS;
['Units Sold'] => ['Net Revenue'];`

// ── UI Controls ─────────────────────────────────────────────────────────────

function Select({ label, value, onChange, options }) {
  return (
    <div className="flex items-center justify-between gap-4 py-1">
      <label className="text-xs text-foreground shrink-0">{label}</label>
      <select
        value={value}
        onChange={e => onChange(e.target.value)}
        className="text-xs bg-background border border-border rounded px-2 py-1 outline-none min-w-[120px]"
      >
        {options.map(o => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
    </div>
  )
}

function Toggle({ label, checked, onChange }) {
  return (
    <div className="flex items-center justify-between gap-4 py-1">
      <label className="text-xs text-foreground">{label}</label>
      <button
        onClick={() => onChange(!checked)}
        className={cn(
          'w-8 h-4 rounded-full transition-colors relative',
          checked ? 'bg-primary' : 'bg-muted'
        )}
      >
        <span className={cn(
          'absolute top-0.5 left-0.5 w-3 h-3 bg-white rounded-full transition-transform',
          checked && 'translate-x-4'
        )} />
      </button>
    </div>
  )
}

function PresetButtons({ active, onSelect }) {
  const presets = listPresets()
  return (
    <div className="flex gap-1.5 mb-3">
      {presets.map(p => (
        <button
          key={p.id}
          onClick={() => onSelect(p.id)}
          className={cn(
            'px-2.5 py-1 text-[10px] rounded border transition-colors',
            active === p.id
              ? 'bg-primary text-primary-foreground border-primary'
              : 'bg-background text-muted-foreground border-border hover:text-foreground'
          )}
          title={p.description}
        >
          {p.name}
        </button>
      ))}
      <button
        onClick={() => onSelect('custom')}
        className={cn(
          'px-2.5 py-1 text-[10px] rounded border transition-colors',
          active === 'custom'
            ? 'bg-primary text-primary-foreground border-primary'
            : 'bg-background text-muted-foreground border-border hover:text-foreground'
        )}
      >
        Custom
      </button>
    </div>
  )
}

// ── Naming Dictionary Editor ─────────────────────────────────────────────────
// Unified table: IBM defaults + custom entries in one view.
// Delete on IBM row = "disable this default" (hide from table).
// Delete on custom row = remove entirely.

function NamingEditor({ onClose }) {
  const { customEntries, disabledDefaults } = getNamingMap()

  // Build unified view: all IBM defaults NOT disabled, plus custom entries
  const buildRows = () => {
    const disabled = new Set(disabledDefaults.map(s => s.toLowerCase()))
    const rows = []

    // IBM defaults that are still enabled
    for (const [input, output] of Object.entries(IBM_DEFAULTS)) {
      if (!disabled.has(input)) {
        rows.push({ id: `ibm-${input}`, input, output, source: 'ibm' })
      }
    }

    // Custom entries
    for (const [input, output] of Object.entries(customEntries)) {
      rows.push({ id: `custom-${input}`, input, output, source: 'custom' })
    }

    // Sort by input
    rows.sort((a, b) => a.input.localeCompare(b.input))
    return { rows, disabled }
  }

  const [{ rows, disabled }, setState] = useState(buildRows)
  const [customOverrides, setCustomOverrides] = useState(() => ({ ...customEntries }))

  const addEntry = () => {
    setState(prev => ({
      ...prev,
      rows: [...prev.rows, { id: `custom-${Date.now()}`, input: '', output: '', source: 'custom' }],
    }))
  }

  const updateEntry = (id, field, value) => {
    setState(prev => ({
      ...prev,
      rows: prev.rows.map(r => r.id === id ? { ...r, [field]: value } : r),
    }))
  }

  const removeEntry = (id) => {
    const row = rows.find(r => r.id === id)
    if (!row) return

    if (row.source === 'ibm') {
      // Disable the IBM default
      setState(prev => ({
        rows: prev.rows.filter(r => r.id !== id),
        disabled: new Set([...prev.disabled, row.input.toLowerCase()]),
      }))
    } else {
      // Remove custom entry
      setState(prev => ({
        ...prev,
        rows: prev.rows.filter(r => r.id !== id),
      }))
    }
  }

  const handleSave = () => {
    const newCustom = {}
    for (const r of rows) {
      if (r.source === 'custom' && r.input.trim()) {
        newCustom[r.input.trim().toLowerCase()] = r.output.trim()
      }
    }
    updateNamingDictionary(newCustom, Array.from(disabled))
    onClose()
  }

  const handleExport = () => {
    const json = exportNamingDictionary()
    const blob = new Blob([json], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'tm1-naming-dictionary.json'
    a.click()
    URL.revokeObjectURL(url)
  }

  const handleImport = async () => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = '.json'
    input.onchange = async (e) => {
      const file = e.target.files[0]
      if (!file) return
      const text = await file.text()
      if (importNamingDictionary(text)) {
        setState(buildRows())
      }
    }
    input.click()
  }

  const handleReset = () => {
    if (window.confirm('Reset naming dictionary to IBM defaults? All custom entries and disabled defaults will be lost.')) {
      resetNamingDictionary()
      setState(buildRows())
    }
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between mb-1">
        <div>
          <h3 className="text-xs font-semibold">Naming Dictionary</h3>
          <p className="text-[9px] text-muted-foreground/70">Case-insensitive matching — Abs, ABS, abs all map to the same output</p>
        </div>
        <div className="flex items-center gap-1">
          <button onClick={handleImport} className="p-1 rounded hover:bg-muted text-muted-foreground" title="Import JSON">
            <Upload size={10} />
          </button>
          <button onClick={handleExport} className="p-1 rounded hover:bg-muted text-muted-foreground" title="Export JSON">
            <Download size={10} />
          </button>
          <button onClick={handleReset} className="p-1 rounded hover:bg-muted text-muted-foreground" title="Reset to defaults">
            <RotateCcw size={10} />
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-auto border border-border rounded">
        <table className="w-full text-[10px]">
          <thead className="bg-muted sticky top-0">
            <tr>
              <th className="text-left px-2 py-1 font-medium">
                When formatter sees
                <span className="ml-1 text-[9px] font-normal text-muted-foreground/60 normal-case" title="Matching is case-insensitive">
                  (case-insensitive)
                </span>
              </th>
              <th className="text-left px-2 py-1 font-medium">Write this instead</th>
              <th className="text-left px-2 py-1 font-medium w-16">Source</th>
              <th className="w-8"></th>
            </tr>
          </thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.id} className="border-b border-border/50">
                <td className="px-1 py-0.5">
                  <input
                    value={r.input}
                    onChange={ev => updateEntry(r.id, 'input', ev.target.value)}
                    className="w-full text-[10px] bg-background border border-border rounded px-1 py-0.5 outline-none font-mono"
                    placeholder="e.g., Db"
                    readOnly={r.source === 'ibm'}
                  />
                </td>
                <td className="px-1 py-0.5">
                  <input
                    value={r.output}
                    onChange={ev => updateEntry(r.id, 'output', ev.target.value)}
                    className="w-full text-[10px] bg-background border border-border rounded px-1 py-0.5 outline-none font-mono"
                    placeholder="e.g., DB"
                  />
                </td>
                <td className="px-1 py-0.5">
                  <span className={cn(
                    'text-[9px] px-1 py-px rounded uppercase tracking-wider font-semibold',
                    r.source === 'ibm' ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300' : 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300'
                  )}>
                    {r.source === 'ibm' ? 'IBM' : 'Custom'}
                  </span>
                </td>
                <td className="px-1 py-0.5">
                  <button onClick={() => removeEntry(r.id)} className="p-0.5 rounded hover:bg-muted text-muted-foreground" title="Remove">
                    <Trash2 size={9} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <button
        onClick={addEntry}
        className="flex items-center justify-center gap-1 mt-2 px-2 py-1 text-[10px] rounded border border-border text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
      >
        <Plus size={9} /> Add mapping
      </button>

      <div className="flex justify-end gap-2 mt-3 pt-2 border-t border-border">
        <button onClick={onClose} className="px-3 py-1 text-[10px] rounded border border-border text-muted-foreground hover:bg-muted">
          Cancel
        </button>
        <button onClick={handleSave} className="flex items-center gap-1 px-3 py-1 text-[10px] rounded bg-primary text-primary-foreground hover:opacity-90">
          <Save size={9} /> Save
        </button>
      </div>
    </div>
  )
}

// ── Live Preview ─────────────────────────────────────────────────────────────

function LivePreview({ settings, namingMap }) {
  const formatted = useMemo(() => {
    try {
      return formatRules(SAMPLE_RULES, settings.rules, namingMap)
    } catch {
      return 'Error formatting preview'
    }
  }, [settings.rules, namingMap])

  return (
    <div className="flex flex-col h-full">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-1">Live Preview</div>
      <div className="flex-1 overflow-auto bg-muted/30 rounded border border-border p-2 font-mono text-[10px] whitespace-pre">
        {formatted}
      </div>
    </div>
  )
}

// ── Main Settings Modal ──────────────────────────────────────────────────────

export default function FormatSettings({ open, onClose }) {
  if (!open) return null

  const [settings, setSettings] = useState(() => loadSettings())
  const [tab, setTab] = useState('rules') // 'general' | 'rules' | 'ti' | 'colours'
  const [showNamingEditor, setShowNamingEditor] = useState(false)
  const [colourSettings, setColourSettings] = useState(() => loadColourSettings())

  const namingData = useMemo(() => getNamingMap(), [showNamingEditor])

  const updateRuleSetting = useCallback((key, value) => {
    setSettings(prev => ({
      ...prev,
      rules: { ...prev.rules, [key]: value },
    }))
  }, [])

  const updateTiSetting = useCallback((key, value) => {
    setSettings(prev => ({
      ...prev,
      ti: { ...prev.ti, [key]: value },
    }))
  }, [])

  const updateEditorSetting = useCallback((key, value) => {
    setSettings(prev => ({
      ...prev,
      editor: { ...prev.editor, [key]: value },
    }))
  }, [])

  const applyRulesPreset = (presetName) => {
    const next = applyPreset(presetName, 'rules', settings)
    setSettings(next)
  }

  const applyTiPreset = (presetName) => {
    const next = applyPreset(presetName, 'ti', settings)
    setSettings(next)
  }

  const handleSave = () => {
    saveSettings(settings)
    saveColourSettings(colourSettings)
    onClose()
  }

  const handleReset = () => {
    if (window.confirm('Reset all format settings to defaults?')) {
      const defaults = resetAllSettings()
      setSettings(defaults)
    }
  }

  const rulePreset = isCustomPreset(settings, 'rules') ? 'custom' : settings.rules.preset
  const tiPreset = isCustomPreset(settings, 'ti') ? 'custom' : settings.ti.preset

  const indentOptions = [
    { value: 'spaces2', label: '2 Spaces' },
    { value: 'spaces4', label: '4 Spaces' },
    { value: 'tab', label: 'Tab' },
  ]

  const spacingOptions = [
    { value: 'none', label: 'None' },
    { value: 'single', label: 'Single' },
    { value: 'double', label: 'Double' },
  ]

  const callSpacingOptions = [
    { value: 'compact', label: 'Compact' },
    { value: 'standard', label: 'Standard' },
    { value: 'expanded', label: 'Expanded' },
  ]

  const opSpacingOptions = [
    { value: 'compact', label: 'Compact' },
    { value: 'standard', label: 'Standard' },
  ]

  const wrapOptions = [
    { value: 'off', label: 'Off' },
    { value: '80', label: '80 chars' },
    { value: '120', label: '120 chars' },
    { value: '160', label: '160 chars' },
  ]

  const wrapIndentOptions = [
    { value: 'same', label: 'Same indent' },
    { value: 'hanging', label: 'Hanging indent' },
  ]

  const ifFormatOptions = [
    { value: 'inline', label: 'Inline' },
    { value: 'multiline', label: 'Multi-line' },
  ]

  const capOptions = [
    { value: 'asIs', label: 'As typed' },
    { value: 'ibmOfficial', label: 'IBM Official' },
    { value: 'lower', label: 'lowercase' },
    { value: 'upper', label: 'UPPERCASE' },
  ]

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-card border border-border rounded-lg shadow-lg w-[720px] max-w-[90vw] h-[560px] max-h-[90vh] flex flex-col">

        {/* Header */}
        <div className="flex items-center justify-between px-4 py-2 border-b border-border shrink-0">
          <h2 className="text-sm font-semibold">Format Settings</h2>
          <button onClick={onClose} className="p-1 rounded hover:bg-muted text-muted-foreground">
            <X size={14} />
          </button>
        </div>

        {/* Body */}
        <div className="flex flex-1 min-h-0">

          {/* Left: Tabs + Settings */}
          <div className="w-[380px] flex flex-col border-r border-border">
            {/* Tabs */}
            <div className="flex border-b border-border shrink-0">
              {[
                { id: 'general', label: 'General' },
                { id: 'rules', label: 'Rules' },
                { id: 'ti', label: 'TI Process' },
                { id: 'colours', label: 'Colours' },
              ].map(t => (
                <button
                  key={t.id}
                  onClick={() => setTab(t.id)}
                  className={cn(
                    'flex-1 py-1.5 text-xs transition-colors',
                    tab === t.id ? 'border-b-2 border-primary text-foreground font-medium' : 'text-muted-foreground hover:text-foreground'
                  )}
                >
                  {t.label}
                </button>
              ))}
            </div>

            {/* Scrollable settings */}
            <div className="flex-1 overflow-auto p-3">
              {tab === 'general' && (
                <div className="space-y-2">
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-2">Editor</div>
                  <Select label="Font family" value={settings.editor.fontFamily} onChange={v => updateEditorSetting('fontFamily', v)} options={[
                    { value: 'Geist Mono', label: 'Geist Mono' },
                    { value: 'Fira Code', label: 'Fira Code' },
                    { value: 'JetBrains Mono', label: 'JetBrains Mono' },
                    { value: 'Cascadia Code', label: 'Cascadia Code' },
                    { value: 'Consolas', label: 'Consolas' },
                    { value: 'Courier New', label: 'Courier New' },
                  ]} />
                  <div className="flex items-center justify-between gap-4 py-1">
                    <label className="text-xs text-foreground">Font size</label>
                    <input type="range" min="10" max="18" value={settings.editor.fontSize} onChange={e => updateEditorSetting('fontSize', parseInt(e.target.value))} className="w-24" />
                    <span className="text-xs text-muted-foreground w-6 text-right">{settings.editor.fontSize}px</span>
                  </div>
                  <div className="flex items-center justify-between gap-4 py-1">
                    <label className="text-xs text-foreground">Line height</label>
                    <input type="range" min="12" max="20" value={Math.round(settings.editor.lineHeight * 10)} onChange={e => updateEditorSetting('lineHeight', parseInt(e.target.value) / 10)} className="w-24" />
                    <span className="text-xs text-muted-foreground w-6 text-right">{settings.editor.lineHeight.toFixed(1)}</span>
                  </div>
                  <Select label="Monaco theme" value={settings.editor.monacoTheme} onChange={v => updateEditorSetting('monacoTheme', v)} options={[
                    { value: 'vs', label: 'Light' },
                    { value: 'vs-dark', label: 'Dark' },
                    { value: 'hc-black', label: 'High Contrast' },
                  ]} />
                  <Select label="UI accent" value={settings.editor.uiAccent} onChange={v => updateEditorSetting('uiAccent', v)} options={[
                    { value: 'blue', label: 'Blue' },
                    { value: 'green', label: 'Green' },
                    { value: 'orange', label: 'Orange' },
                    { value: 'purple', label: 'Purple' },
                    { value: 'red', label: 'Red' },
                  ]} />
                </div>
              )}

              {tab === 'rules' && (
                <div className="space-y-2">
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Preset</div>
                  <PresetButtons active={rulePreset} onSelect={applyRulesPreset} />

                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mt-2">Spacing</div>
                  <Select label="Indent style" value={settings.rules.indentStyle} onChange={v => updateRuleSetting('indentStyle', v)} options={indentOptions} />
                  <Select label="Area prefix" value={settings.rules.areaPrefixSpacing} onChange={v => updateRuleSetting('areaPrefixSpacing', v)} options={spacingOptions} />
                  <Select label="Function calls" value={settings.rules.functionCallSpacing} onChange={v => updateRuleSetting('functionCallSpacing', v)} options={callSpacingOptions} />
                  <Select label="Comma spacing" value={settings.rules.commaSpacing} onChange={v => updateRuleSetting('commaSpacing', v)} options={spacingOptions.slice(0, 2)} />
                  <Select label="Semicolon spacing" value={settings.rules.semicolonSpacing} onChange={v => updateRuleSetting('semicolonSpacing', v)} options={spacingOptions.slice(0, 2)} />
                  <Select label="Operator spacing" value={settings.rules.operatorSpacing} onChange={v => updateRuleSetting('operatorSpacing', v)} options={opSpacingOptions} />

                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mt-2">Layout</div>
                  <Toggle label="Align = signs" checked={settings.rules.alignEquals} onChange={v => updateRuleSetting('alignEquals', v)} />
                  <Select label="Line wrap" value={settings.rules.lineWrap} onChange={v => updateRuleSetting('lineWrap', v)} options={wrapOptions} />
                  <Select label="Wrap indent" value={settings.rules.wrapIndent} onChange={v => updateRuleSetting('wrapIndent', v)} options={wrapIndentOptions} />
                  <Select label="IF formatting" value={settings.rules.ifFormatting} onChange={v => updateRuleSetting('ifFormatting', v)} options={ifFormatOptions} />

                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mt-2">Capitalization</div>
                  <Select label="Style" value={settings.rules.capitalization} onChange={v => updateRuleSetting('capitalization', v)} options={capOptions} />
                  <button
                    onClick={() => setShowNamingEditor(true)}
                    className="w-full text-left px-2 py-1 text-[10px] rounded border border-border text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                  >
                    Edit Naming Dictionary…
                  </button>

                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mt-2">Safety</div>
                  <Toggle label="Preserve comments" checked={settings.rules.preserveComments} onChange={v => updateRuleSetting('preserveComments', v)} />
                  <Toggle label="Preserve strings" checked={settings.rules.preserveStrings} onChange={v => updateRuleSetting('preserveStrings', v)} />
                </div>
              )}

              {tab === 'ti' && (
                <div className="space-y-2">
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Preset</div>
                  <PresetButtons active={tiPreset} onSelect={applyTiPreset} />

                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mt-2">Spacing</div>
                  <Select label="Indent style" value={settings.ti.indentStyle} onChange={v => updateTiSetting('indentStyle', v)} options={indentOptions} />
                  <Select label="Function calls" value={settings.ti.functionCallSpacing} onChange={v => updateTiSetting('functionCallSpacing', v)} options={callSpacingOptions} />
                  <Select label="Comma spacing" value={settings.ti.commaSpacing} onChange={v => updateTiSetting('commaSpacing', v)} options={spacingOptions.slice(0, 2)} />
                  <Select label="Operator spacing" value={settings.ti.operatorSpacing} onChange={v => updateTiSetting('operatorSpacing', v)} options={opSpacingOptions} />

                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mt-2">Layout</div>
                  <Select label="Line wrap" value={settings.ti.lineWrap} onChange={v => updateTiSetting('lineWrap', v)} options={wrapOptions} />
                  <Toggle label="Align assignments" checked={settings.ti.alignAssignments} onChange={v => updateTiSetting('alignAssignments', v)} />

                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mt-2">Capitalization</div>
                  <Select label="Keyword case" value={settings.ti.keywordCase} onChange={v => updateTiSetting('keywordCase', v)} options={capOptions} />

                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mt-2">Safety</div>
                  <Toggle label="Preserve metadata blocks" checked={settings.ti.preserveMetadataBlocks} onChange={v => updateTiSetting('preserveMetadataBlocks', v)} />
                </div>
              )}

              {tab === 'colours' && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Rules Syntax Colours</div>
                    <div className="flex items-center gap-1">
                      <button onClick={() => {
                        const json = exportColourSettings()
                        const blob = new Blob([json], { type: 'application/json' })
                        const url = URL.createObjectURL(blob)
                        const a = document.createElement('a')
                        a.href = url
                        a.download = 'tm1-colour-scheme.json'
                        a.click()
                        URL.revokeObjectURL(url)
                      }} className="p-1 rounded hover:bg-muted text-muted-foreground" title="Export">
                        <Download size={9} />
                      </button>
                      <button onClick={() => {
                        const input = document.createElement('input')
                        input.type = 'file'
                        input.accept = '.json'
                        input.onchange = async (e) => {
                          const file = e.target.files[0]
                          if (!file) return
                          const text = await file.text()
                          if (importColourSettings(text)) {
                            setColourSettings(loadColourSettings())
                          }
                        }
                        input.click()
                      }} className="p-1 rounded hover:bg-muted text-muted-foreground" title="Import">
                        <Upload size={9} />
                      </button>
                    </div>
                  </div>
                  <p className="text-[9px] text-muted-foreground/70">Set hex colours for each token type in the Rules editor. Changes apply on editor refresh.</p>

                  {Object.entries(colourSettings.rules).map(([tokenType, colour]) => (
                    <div key={tokenType} className="flex items-center justify-between gap-2 py-0.5">
                      <label className="text-[10px] text-foreground capitalize flex-1">{tokenType.replace('_', ' ')}</label>
                      <div className="flex items-center gap-1.5">
                        <input
                          type="color"
                          value={colour}
                          onChange={e => {
                            const next = { ...colourSettings, rules: { ...colourSettings.rules, [tokenType]: e.target.value } }
                            setColourSettings(next)
                          }}
                          className="w-6 h-5 p-0 border-0 rounded cursor-pointer"
                        />
                        <span className="text-[9px] font-mono text-muted-foreground w-16">{colour}</span>
                      </div>
                    </div>
                  ))}

                  <button
                    onClick={() => {
                      if (window.confirm('Reset all colours to defaults?')) {
                        resetColourSettings()
                        setColourSettings(structuredClone(DEFAULT_COLOURS))
                      }
                    }}
                    className="flex items-center gap-1 mt-2 px-2 py-1 text-[10px] rounded border border-border text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                  >
                    <RotateCcw size={9} /> Reset colours
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* Right: Live Preview */}
          <div className="flex-1 p-3">
            {showNamingEditor ? (
              <NamingEditor onClose={() => setShowNamingEditor(false)} />
            ) : (
              <LivePreview settings={settings} namingMap={namingData.map} />
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-4 py-2 border-t border-border shrink-0">
          <button
            onClick={handleReset}
            className="flex items-center gap-1 px-2 py-1 text-[10px] rounded border border-border text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
          >
            <RotateCcw size={9} /> Reset to defaults
          </button>
          <div className="flex items-center gap-2">
            <button onClick={onClose} className="px-3 py-1 text-xs rounded border border-border text-muted-foreground hover:bg-muted">
              Cancel
            </button>
            <button onClick={handleSave} className="flex items-center gap-1 px-3 py-1 text-xs rounded bg-primary text-primary-foreground hover:opacity-90">
              <Save size={10} /> Save
            </button>
          </div>
        </div>

      </div>
    </div>
  )
}
