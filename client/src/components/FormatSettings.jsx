import { useState, useMemo, useCallback } from 'react'
import { useStore } from '@/store'
import { X, RotateCcw, Save, Download, Upload, Plus, Trash2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { loadSettings, saveSettings, resetAllSettings } from '@/lib/formatters/settings.js'
import { getNamingMap, updateNamingDictionary, resetNamingDictionary, exportNamingDictionary, importNamingDictionary, IBM_DEFAULTS } from '@/lib/formatters/naming.js'
import { formatRules } from '@/lib/formatters/rules-formatter.js'
import { tokenize } from '@/lib/formatters/tokenizer.js'
import { listPresets } from '@/lib/formatters/presets.js'
import { loadColourSettings, saveColourSettings, resetColourSettings, exportColourSettings, importColourSettings, DEFAULT_COLOURS, COLOUR_THEMES, applyColourTheme } from '@/lib/formatters/colours.js'

// ── Sample code for live preview ──────────────────────────────────────────────

const SAMPLE_TI = `#****Begin: Generated Statements***
#****End: Generated Statements****

DimName='FCM Journal Item';

#DimensionDeleteAllElements(DimName);

# Create hierarchy [Year-Year Period-Month]

StartYear='2013';
EndYear='2018';

NumberYears = NUMBR(EndYear)-NUMBR(StartYear);
Counter = NumberYears;

While (Counter >= 0);
  ElNameYear = STR((NUMBR(EndYear)-Counter), 4, 0);
  DimensionElementInsert(DimName, '', ElNameYear, 'N');

  # Add Year Period Code to hierarchies
  vNumberYearPeriods = 5;
  vCounter = 0;

  While (vCounter <= vNumberYearPeriods);
    ElNamePY = ElNameYear|'-'|'Y0'|STR(vCounter, 1, 0);
    DimensionElementInsert(DimName, '', ElNamePY, 'N');
    DimensionElementComponentAdd(DimName, ElNameYear, ElNamePY, 1);
    vCounter = vCounter + 1;
  End;

  Counter = Counter - 1;
End;`

const SAMPLE_RULES = `#Region Revenue
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

function LivePreview({ settings, colourSettings, namingMap, sampleCode, skipFormat }) {
  const formatted = useMemo(() => {
    if (skipFormat) return sampleCode
    try {
      return formatRules(sampleCode, settings.rules, namingMap)
    } catch {
      return 'Error formatting preview'
    }
  }, [sampleCode, skipFormat, settings.rules, namingMap])

  const lines = useMemo(() => formatted.split('\n').map(line => tokenize(line)), [formatted])

  const colours = colourSettings?.rules ?? {}
  const getColour = (type) => colours[type] ?? colours.default ?? '#f8f8f2'

  return (
    <div className="flex flex-col h-full">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-1">Live Preview</div>
      <div className="flex-1 overflow-auto rounded border border-border p-2 font-mono text-[10px]" style={{ background: colourSettings?.background ?? '#1e1e1e' }}>
        {lines.map((lineTokens, i) => (
          <div key={i} className="whitespace-pre leading-5">
            {lineTokens.length === 0
              ? ' '
              : lineTokens.map((tok, j) => (
                  <span key={j} style={tok.type !== 'whitespace' ? { color: getColour(tok.type) } : undefined}>
                    {tok.value}
                  </span>
                ))
            }
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Main Settings Modal ──────────────────────────────────────────────────────

export default function FormatSettings({ open, onClose }) {
  if (!open) return null

  const { bumpThemeVersion } = useStore()
  const [settings, setSettings] = useState(() => loadSettings())
  const [tab, setTab] = useState('rules') // 'rules' | 'ti' | 'colours'
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

  const handleSave = () => {
    saveSettings(settings)
    saveColourSettings(colourSettings)
    bumpThemeVersion()
    onClose()
  }

  const handleReset = () => {
    if (window.confirm('Reset all format settings to defaults?')) {
      const defaults = resetAllSettings()
      setSettings(defaults)
    }
  }

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
              {tab === 'rules' && (
                <div className="space-y-2">
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Structure</div>
                  <div className="flex gap-1.5 mb-1">
                    {[
                      { id: null,             label: 'No Change' },
                      { id: 'tm1-verbose',    label: 'TM1 Verbose' },
                      { id: 'tm1-structured', label: 'TM1 Structured' },
                    ].map(opt => (
                      <button
                        key={opt.id ?? 'none'}
                        onClick={() => updateRuleSetting('expressionFormatter', opt.id)}
                        className={cn(
                          'px-2.5 py-1 text-[10px] rounded border transition-colors',
                          settings.rules.expressionFormatter === opt.id
                            ? 'bg-primary text-primary-foreground border-primary'
                            : 'bg-background text-muted-foreground border-border hover:text-foreground'
                        )}
                        title={opt.id === null ? 'Keep existing line structure' : opt.id === 'tm1-verbose' ? 'Each string argument on its own line' : 'Consecutive string arguments grouped on one line'}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>

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
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Spacing</div>
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
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-1">Theme</div>
                  <div className="flex flex-wrap gap-1.5 mb-3">
                    {COLOUR_THEMES.map(t => (
                      <button
                        key={t.id}
                        onClick={() => setColourSettings(applyColourTheme(t.id, colourSettings))}
                        className={cn(
                          'px-2.5 py-1 text-[10px] rounded border transition-colors',
                          colourSettings.theme === t.id
                            ? 'bg-primary text-primary-foreground border-primary'
                            : 'bg-background text-muted-foreground border-border hover:text-foreground'
                        )}
                      >
                        <span
                          className="inline-block w-2 h-2 rounded-full mr-1.5 align-middle border border-white/20"
                          style={{ background: t.background }}
                        />
                        {t.name}
                      </button>
                    ))}
                    {!COLOUR_THEMES.find(t => t.id === colourSettings.theme) && (
                      <span className="px-2.5 py-1 text-[10px] rounded border border-primary bg-primary text-primary-foreground">Custom</span>
                    )}
                  </div>

                  <div className="flex items-center justify-between">
                    <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Token Colours</div>
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
                            setColourSettings(prev => ({ ...prev, theme: 'custom', rules: { ...prev.rules, [tokenType]: e.target.value } }))
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
              <LivePreview
                settings={settings}
                colourSettings={colourSettings}
                namingMap={namingData.map}
                sampleCode={tab === 'ti' ? SAMPLE_TI : SAMPLE_RULES}
                skipFormat={tab === 'ti'}
              />
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
