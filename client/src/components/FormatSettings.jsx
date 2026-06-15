import { useState, useMemo, useCallback } from 'react'
import { useStore } from '@/store'
import { X, RotateCcw, Save, Download, Upload, ChevronDown, ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils'
import { loadSettings, saveSettings, resetAllSettings } from '@/lib/formatters/settings.js'
import { getNamingMap } from '@/lib/formatters/naming.js'
import { formatRules } from '@/lib/formatters/rules-formatter.js'
import { tokenize } from '@/lib/formatters/tokenizer.js'
import { loadColourSettings, saveColourSettings, resetColourSettings, exportColourSettings, importColourSettings, DEFAULT_COLOURS, COLOUR_THEMES, applyColourTheme } from '@/lib/formatters/colours.js'

// ── Sample code for preview ───────────────────────────────────────────────────

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

const SAMPLE_RULES = `#Region Calculations
['Sales'] = N: DB('Sales Cube', !Region, !Product, !Period, 'Actual', 'USD', 'Net');
['Margin'] = N: IF(DB('Sales Cube', !Region, !Product, !Period, 'Actual', 'USD') > 0, DB('Cost Cube', !Region, !Product, !Period, 'Plan', 'USD'), CONTINUE);
#EndRegion

FEEDERS;
['Sales'] => DB('Sales Cube', !Region, !Product, !Period, 'Actual', 'USD', 'Net');`

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

function Section({ label, open, onToggle, children }) {
  return (
    <div className="mt-2">
      <button
        onClick={onToggle}
        className="flex items-center gap-1 text-[10px] uppercase tracking-wider text-muted-foreground font-semibold w-full text-left mb-1 hover:text-foreground transition-colors"
      >
        {open ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
        {label}
      </button>
      {open && <div className="space-y-0.5">{children}</div>}
    </div>
  )
}

// ── Live Preview ─────────────────────────────────────────────────────────────

const LIGHT_COLOURS = {
  string: '#b91c1c', keyword: '#1d4ed8', comment: '#6b7280',
  identifier: '#111827', operator: '#7c3aed', number: '#b45309',
  dim_var: '#047857', directive: '#6b7280', area_prefix: '#7c3aed',
  default: '#111827',
}

function CodePanel({ formatted, colourSettings, label, dark }) {
  const lines = useMemo(() => formatted.split('\n').map(line => tokenize(line)), [formatted])
  const darkColours = colourSettings?.rules ?? {}
  const getColour = type => dark
    ? (darkColours[type] ?? darkColours.default ?? '#f8f8f2')
    : (LIGHT_COLOURS[type] ?? LIGHT_COLOURS.default)
  const bg = dark ? (colourSettings?.background ?? '#1e1e1e') : '#f5f5f5'
  return (
    <div className="flex flex-col flex-1 min-h-0">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground/60 font-semibold mb-1">{label}</div>
      <div className="flex-1 overflow-auto rounded border border-border p-2 font-mono text-[10px]" style={{ background: bg }}>
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

function RulesPreview({ settings, colourSettings, namingMap, dark }) {
  const verboseFormatted = useMemo(() => {
    try { return formatRules(SAMPLE_RULES, { ...settings.rules, expressionFormatter: 'tm1-verbose' }, namingMap) }
    catch { return 'Error formatting preview' }
  }, [settings.rules, namingMap])

  const structuredFormatted = useMemo(() => {
    try { return formatRules(SAMPLE_RULES, { ...settings.rules, expressionFormatter: 'tm1-structured' }, namingMap) }
    catch { return 'Error formatting preview' }
  }, [settings.rules, namingMap])

  return (
    <div className="flex flex-col h-full">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-2">Preview</div>
      <div className="flex flex-col flex-1 min-h-0 gap-2">
        <CodePanel formatted={verboseFormatted} colourSettings={colourSettings} label="TM1 Verbose" dark={dark} />
        <CodePanel formatted={structuredFormatted} colourSettings={colourSettings} label="TM1 Structured" dark={dark} />
      </div>
    </div>
  )
}

function TIPreview({ colourSettings, sampleCode, dark }) {
  const lines = useMemo(() => sampleCode.split('\n').map(line => tokenize(line)), [sampleCode])
  const darkColours = colourSettings?.rules ?? {}
  const getColour = type => dark
    ? (darkColours[type] ?? darkColours.default ?? '#f8f8f2')
    : (LIGHT_COLOURS[type] ?? LIGHT_COLOURS.default)
  const bg = dark ? (colourSettings?.background ?? '#1e1e1e') : '#f5f5f5'
  return (
    <div className="flex flex-col h-full">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-1">Preview</div>
      <div className="flex-1 overflow-auto rounded border border-border p-2 font-mono text-[10px]" style={{ background: bg }}>
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

  const { bumpThemeVersion, dark } = useStore()
  const [settings, setSettings]           = useState(() => loadSettings())
  const [tab, setTab]                     = useState('rules')
  const [colourSettings, setColourSettings] = useState(() => loadColourSettings())
  const [rulesSpacingOpen, setRulesSpacingOpen] = useState(true)
  const [rulesLayoutOpen, setRulesLayoutOpen]   = useState(true)
  const [tiSpacingOpen, setTiSpacingOpen]       = useState(true)
  const [tiLayoutOpen, setTiLayoutOpen]         = useState(true)

  const namingData = useMemo(() => getNamingMap(), [])

  const updateRuleSetting = useCallback((key, value) => {
    setSettings(prev => ({ ...prev, rules: { ...prev.rules, [key]: value } }))
  }, [])

  const updateTiSetting = useCallback((key, value) => {
    setSettings(prev => ({ ...prev, ti: { ...prev.ti, [key]: value } }))
  }, [])

  const handleSave = () => {
    saveSettings(settings)
    saveColourSettings(colourSettings)
    bumpThemeVersion()
    onClose()
  }

  const handleReset = () => {
    if (window.confirm('Reset all format settings to defaults?')) {
      setSettings(resetAllSettings())
    }
  }

  const indentOpts    = [{ value: 'spaces2', label: '2 Spaces' }, { value: 'spaces4', label: '4 Spaces' }, { value: 'tab', label: 'Tab' }]
  const spacingOpts   = [{ value: 'none', label: 'None' }, { value: 'single', label: 'Single' }, { value: 'double', label: 'Double' }]
  const callOpts      = [{ value: 'compact', label: 'Compact' }, { value: 'standard', label: 'Standard' }, { value: 'expanded', label: 'Expanded' }]
  const opOpts        = [{ value: 'compact', label: 'Compact' }, { value: 'standard', label: 'Standard' }]
  const wrapOpts      = [{ value: 'off', label: 'Off' }, { value: '80', label: '80 chars' }, { value: '120', label: '120 chars' }, { value: '160', label: '160 chars' }]
  const wrapIndOpts   = [{ value: 'same', label: 'Same indent' }, { value: 'hanging', label: 'Hanging indent' }]
  const ifOpts        = [{ value: 'inline', label: 'Inline' }, { value: 'multiline', label: 'Multi-line' }]
  const capOpts       = [{ value: 'asIs', label: 'As typed' }, { value: 'ibmOfficial', label: 'IBM Official' }, { value: 'lower', label: 'lowercase' }, { value: 'upper', label: 'UPPERCASE' }]

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-card border border-border rounded-lg shadow-lg w-[720px] max-w-[90vw] h-[560px] max-h-[90vh] flex flex-col">

        {/* Header */}
        <div className="flex items-center justify-between px-4 py-2 border-b border-border shrink-0">
          <h2 className="text-sm font-semibold">Format Settings</h2>
          <button onClick={onClose} className="p-1 rounded hover:bg-muted text-muted-foreground"><X size={14} /></button>
        </div>

        {/* Body */}
        <div className="flex flex-1 min-h-0">

          {/* Left: Tabs + Settings */}
          <div className="w-[340px] flex flex-col border-r border-border">
            <div className="flex border-b border-border shrink-0">
              {[{ id: 'rules', label: 'Rules' }, { id: 'ti', label: 'TI Process' }].map(t => (
                <button
                  key={t.id}
                  onClick={() => setTab(t.id)}
                  className={cn('flex-1 py-1.5 text-xs transition-colors', tab === t.id ? 'border-b-2 border-primary text-foreground font-medium' : 'text-muted-foreground hover:text-foreground')}
                >
                  {t.label}
                </button>
              ))}
            </div>

            <div className="flex-1 overflow-auto p-3">
              {tab === 'rules' && (
                <div>
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-1">Structure</div>
                  <div className="flex gap-1.5 mb-2">
                    {[{ id: null, label: 'No Change' }, { id: 'tm1-verbose', label: 'TM1 Verbose' }, { id: 'tm1-structured', label: 'TM1 Structured' }].map(opt => (
                      <button
                        key={opt.id ?? 'none'}
                        onClick={() => updateRuleSetting('expressionFormatter', opt.id)}
                        className={cn('px-2 py-1 text-[10px] rounded border transition-colors flex-1',
                          settings.rules.expressionFormatter === opt.id
                            ? 'bg-primary text-primary-foreground border-primary'
                            : 'bg-background text-muted-foreground border-border hover:text-foreground'
                        )}
                      >{opt.label}</button>
                    ))}
                  </div>

                  <Section label="Spacing" open={rulesSpacingOpen} onToggle={() => setRulesSpacingOpen(v => !v)}>
                    <Select label="Indent"     value={settings.rules.indentStyle}         onChange={v => updateRuleSetting('indentStyle', v)}         options={indentOpts} />
                    <Select label="Area prefix" value={settings.rules.areaPrefixSpacing}  onChange={v => updateRuleSetting('areaPrefixSpacing', v)}   options={spacingOpts} />
                    <Select label="Functions"   value={settings.rules.functionCallSpacing} onChange={v => updateRuleSetting('functionCallSpacing', v)} options={callOpts} />
                    <Select label="Commas"      value={settings.rules.commaSpacing}        onChange={v => updateRuleSetting('commaSpacing', v)}        options={spacingOpts.slice(0, 2)} />
                    <Select label="Semicolons"  value={settings.rules.semicolonSpacing}    onChange={v => updateRuleSetting('semicolonSpacing', v)}    options={spacingOpts.slice(0, 2)} />
                    <Select label="Operators"   value={settings.rules.operatorSpacing}     onChange={v => updateRuleSetting('operatorSpacing', v)}     options={opOpts} />
                  </Section>

                  <Section label="Layout" open={rulesLayoutOpen} onToggle={() => setRulesLayoutOpen(v => !v)}>
                    <Toggle label="Align = signs" checked={settings.rules.alignEquals}   onChange={v => updateRuleSetting('alignEquals', v)} />
                    <Select label="Line wrap"     value={settings.rules.lineWrap}         onChange={v => updateRuleSetting('lineWrap', v)}    options={wrapOpts} />
                    <Select label="Wrap indent"   value={settings.rules.wrapIndent}       onChange={v => updateRuleSetting('wrapIndent', v)}  options={wrapIndOpts} />
                    <Select label="IF format"     value={settings.rules.ifFormatting}     onChange={v => updateRuleSetting('ifFormatting', v)} options={ifOpts} />
                  </Section>

                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mt-3 mb-1">Capitalisation</div>
                  <Select label="Style" value={settings.rules.capitalization} onChange={v => updateRuleSetting('capitalization', v)} options={capOpts} />

                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mt-3 mb-1">Safety</div>
                  <Toggle label="Preserve comments" checked={settings.rules.preserveComments} onChange={v => updateRuleSetting('preserveComments', v)} />
                  <Toggle label="Preserve strings"  checked={settings.rules.preserveStrings}  onChange={v => updateRuleSetting('preserveStrings', v)} />
                </div>
              )}

              {tab === 'ti' && (
                <div>
                  <Section label="Spacing" open={tiSpacingOpen} onToggle={() => setTiSpacingOpen(v => !v)}>
                    <Select label="Indent"    value={settings.ti.indentStyle}         onChange={v => updateTiSetting('indentStyle', v)}         options={indentOpts} />
                    <Select label="Functions" value={settings.ti.functionCallSpacing} onChange={v => updateTiSetting('functionCallSpacing', v)} options={callOpts} />
                    <Select label="Commas"    value={settings.ti.commaSpacing}        onChange={v => updateTiSetting('commaSpacing', v)}        options={spacingOpts.slice(0, 2)} />
                    <Select label="Operators" value={settings.ti.operatorSpacing}     onChange={v => updateTiSetting('operatorSpacing', v)}     options={opOpts} />
                  </Section>

                  <Section label="Layout" open={tiLayoutOpen} onToggle={() => setTiLayoutOpen(v => !v)}>
                    <Select label="Line wrap"        value={settings.ti.lineWrap}         onChange={v => updateTiSetting('lineWrap', v)}         options={wrapOpts} />
                    <Toggle label="Align assignments" checked={settings.ti.alignAssignments} onChange={v => updateTiSetting('alignAssignments', v)} />
                  </Section>

                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mt-3 mb-1">Capitalisation</div>
                  <Select label="Keyword case" value={settings.ti.keywordCase} onChange={v => updateTiSetting('keywordCase', v)} options={capOpts} />

                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mt-3 mb-1">Safety</div>
                  <Toggle label="Preserve metadata blocks" checked={settings.ti.preserveMetadataBlocks} onChange={v => updateTiSetting('preserveMetadataBlocks', v)} />
                </div>
              )}

            </div>
          </div>

          {/* Right: Preview */}
          <div className="flex-1 p-3">
            {tab === 'rules'
              ? <RulesPreview settings={settings} colourSettings={colourSettings} namingMap={namingData.map} dark={dark} />
              : <TIPreview sampleCode={SAMPLE_TI} colourSettings={colourSettings} dark={dark} />
            }
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-4 py-2 border-t border-border shrink-0">
          <button onClick={handleReset} className="flex items-center gap-1 px-2 py-1 text-[10px] rounded border border-border text-muted-foreground hover:text-foreground hover:bg-muted transition-colors">
            <RotateCcw size={9} /> Reset to defaults
          </button>
          <div className="flex items-center gap-2">
            <button onClick={onClose} className="px-3 py-1 text-xs rounded border border-border text-muted-foreground hover:bg-muted">Cancel</button>
            <button onClick={handleSave} className="flex items-center gap-1 px-3 py-1 text-xs rounded bg-primary text-primary-foreground hover:opacity-90">
              <Save size={10} /> Save
            </button>
          </div>
        </div>

      </div>
    </div>
  )
}
