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
      className="bg-input border border-border rounded px-2 py-1.5 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
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

        <div className="grid grid-cols-2 gap-3">
          <Field label="First Calendar Year">
            <NumberInput
              value={params.firstCalYear}
              onChange={set('firstCalYear')}
              min={1990}
              max={params.lastCalYear - 1}
            />
          </Field>
          <Field label="Last Calendar Year">
            <NumberInput
              value={params.lastCalYear}
              onChange={set('lastCalYear')}
              min={params.firstCalYear + 1}
              max={2100}
            />
          </Field>
        </div>

        <Field label="Partial Boundary FYs">
          <Select value={params.partialBoundary} onChange={set('partialBoundary')}>
            <option value="include">Include partial first &amp; last FY</option>
            <option value="full-only">Full FYs only</option>
          </Select>
        </Field>
      </div>

      {/* Right column */}
      <div className="flex flex-col gap-4">
        <Field label="Year Member Format">
          <Select value={params.yearFormat} onChange={set('yearFormat')}>
            <option value="fy-end">FY + end year  (FY2024)</option>
            <option value="fy-start">FY + start year  (FY2023)</option>
            <option value="yyyy">Year only  (2024)</option>
          </Select>
        </Field>

        <Field label="Month Member Format">
          <Select value={params.monthFormat} onChange={set('monthFormat')}>
            <option value="YYYY-MM">YYYY-MM  (2024-04)</option>
            <option value="Mon-YY">Mon-YY  (Apr-24)</option>
            <option value="YYYYMM">YYYYMM  (202404)</option>
          </Select>
        </Field>

        <Field label="Caption Attribute Format">
          <Select value={params.captionFormat} onChange={set('captionFormat')}>
            <option value="Mon-YY">Mon-YY  (Apr-24)</option>
            <option value="Mon YYYY">Mon YYYY  (Apr 2024)</option>
            <option value="MMMM YYYY">Month YYYY  (April 2024)</option>
          </Select>
        </Field>

        <Field label="Long Name Attribute Format">
          <Select value={params.longNameFormat} onChange={set('longNameFormat')}>
            <option value="Month YYYY">Month YYYY  (April 2024)</option>
            <option value="YYYY-MM">YYYY-MM  (2024-04)</option>
          </Select>
        </Field>
      </div>

      {/* Full-width toggles */}
      <div className="col-span-2 flex flex-col gap-3 pt-2 border-t border-border">
        <Toggle
          checked={params.includeTotal}
          onChange={set('includeTotal')}
          label="Include Total member"
        />
        <Toggle
          checked={params.includeCurrentPeriodAttr}
          onChange={set('includeCurrentPeriodAttr')}
          label='Include "Is Current Period" attribute  (required for dynamic subsets)'
        />
      </div>
    </div>
  )
}
