import { useMemo } from 'react'

const MONTHS = [
  'January','February','March','April','May','June',
  'July','August','September','October','November','December',
]

function Field({ label, children }) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-xs text-muted-foreground font-medium">{label}</label>
      {children}
    </div>
  )
}

function Select({ value, onChange, children }) {
  return (
    <select
      value={value}
      onChange={e => onChange(e.target.value)}
      className="bg-card border border-border rounded px-2 py-1.5 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
    >
      {children}
    </select>
  )
}

function TextInput({ value, onChange }) {
  return (
    <input
      type="text"
      value={value}
      onChange={e => onChange(e.target.value)}
      className="bg-input border border-border rounded px-2 py-1.5 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
    />
  )
}

function NumberInput({ value, onChange, min, max }) {
  return (
    <input
      type="number"
      value={value}
      min={min}
      max={max}
      onChange={e => onChange(Number(e.target.value))}
      className="bg-input border border-border rounded px-2 py-1.5 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary w-full"
    />
  )
}

function Toggle({ checked, onChange, label }) {
  return (
    <label className="flex items-center gap-2 cursor-pointer select-none text-sm">
      <div
        className={`w-8 h-4 rounded-full transition-colors ${checked ? 'bg-primary' : 'bg-muted'} relative`}
        onClick={() => onChange(!checked)}
      >
        <div className={`absolute top-0.5 w-3 h-3 rounded-full bg-white transition-transform ${checked ? 'translate-x-4' : 'translate-x-0.5'}`} />
      </div>
      <span className="text-foreground">{label}</span>
    </label>
  )
}

export default function Step1Parameters({ params, onChange }) {
  const set = (key) => (val) => onChange({ ...params, [key]: val })
  const currentYear = new Date().getFullYear()

  const periodOptions = useMemo(() => {
    const opts = [{ value: '', label: '— select —' }]
    for (let fy = params.firstFY; fy <= params.lastFY; fy++) {
      let y = fy - 1, m = params.fyStartMonth
      for (let i = 0; i < 12; i++) {
        const label = `${y}-${m < 10 ? '0' + m : m}`
        opts.push({ value: label, label })
        m++; if (m > 12) { m = 1; y++ }
      }
    }
    return opts
  }, [params.firstFY, params.lastFY, params.fyStartMonth])

  return (
    <div className="grid grid-cols-2 gap-x-8 gap-y-4 p-6">

      {/* Left column */}
      <div className="flex flex-col gap-4">
        <Field label="Dimension Name">
          <TextInput value={params.dimensionName} onChange={set('dimensionName')} />
        </Field>

        <Field label="Fiscal Year Start Month">
          <Select value={params.fyStartMonth} onChange={v => set('fyStartMonth')(Number(v))}>
            {MONTHS.map((m, i) => (
              <option key={i} value={i + 1}>{m}</option>
            ))}
          </Select>
        </Field>

        <Field label="Default Current Period">
          <Select value={params.defaultCurrentPeriod || ''} onChange={v => set('defaultCurrentPeriod')(v)}>
            {periodOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </Select>
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="First Fiscal Year">
            <NumberInput
              value={params.firstFY}
              onChange={set('firstFY')}
              min={1990}
              max={params.lastFY - 1}
            />
          </Field>
          <Field label="Last Fiscal Year">
            <NumberInput
              value={params.lastFY}
              onChange={set('lastFY')}
              min={params.firstFY + 1}
              max={2100}
            />
          </Field>
        </div>
      </div>

      {/* Right column */}
      <div className="flex flex-col gap-4">
        <Field label="Year Member Format">
          <Select value={params.yearFormat} onChange={set('yearFormat')}>
            <option value="fy-end">FY + end year  (FY2027)</option>
            <option value="fy-start">FY + start year  (FY2026)</option>
            <option value="yyyy">Year only  (2027)</option>
          </Select>
        </Field>

        <Field label="Month Member Format">
          <Select value={params.monthFormat} onChange={set('monthFormat')}>
            <option value="YYYY-MM">YYYY-MM  (2027-04)</option>
            <option value="Mon-YY">Mon-YY  (Apr-27)</option>
            <option value="YYYYMM">YYYYMM  (202704)</option>
          </Select>
        </Field>

        <Field label="Caption Attribute Format">
          <Select value={params.captionFormat} onChange={set('captionFormat')}>
            <option value="Mon-YY">Mon-YY  (Apr-27)</option>
            <option value="Mon YYYY">Mon YYYY  (Apr 2027)</option>
            <option value="MMMM YYYY">Month YYYY  (April 2027)</option>
          </Select>
        </Field>

        <Field label="Long Name Attribute Format">
          <Select value={params.longNameFormat} onChange={set('longNameFormat')}>
            <option value="Month YYYY">Month YYYY  (April 2027)</option>
            <option value="YYYY-MM">YYYY-MM  (2027-04)</option>
          </Select>
        </Field>
      </div>

      {/* Full-width toggles */}
      <div className="col-span-2 flex flex-col gap-3 pt-2 border-t border-border">
        <Toggle
          checked={params.replaceDimension}
          onChange={set('replaceDimension')}
          label={
            <span className={params.replaceDimension ? 'text-red-400' : ''}>
              Replace existing dimension (DESTROYS current {params.dimensionName} dimension)
            </span>
          }
        />
      </div>
    </div>
  )
}
