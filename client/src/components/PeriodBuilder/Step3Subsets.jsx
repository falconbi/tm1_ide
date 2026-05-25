import { useState } from 'react'
import { SUBSET_DEFS } from './lib/subsetDefs.js'
import { generateBuildDimensionTI, generateRefreshSubsetsTI, generateRolloverTI } from './lib/generateTI.js'
import { cn } from '@/lib/utils'

export default function Step3Subsets({
  params,
  computed,
  selectedSubsets,
  onSubsetsChange,
  subsetPrefix,
  onPrefixChange,
  onGenerate,
  generating,
}) {
  const [preview, setPreview] = useState(null) // 'build' | 'subsets' | 'rollover' | null

  const toggle = (id) => {
    if (selectedSubsets.includes(id)) {
      onSubsetsChange(selectedSubsets.filter(s => s !== id))
    } else {
      onSubsetsChange([...selectedSubsets, id])
    }
  }

  const currentAttrEnabled = params.includeCurrentPeriodAttr

  const buildCode    = generateBuildDimensionTI(params, computed)
  const subsetsCode  = selectedSubsets.length > 0
    ? generateRefreshSubsetsTI(params, computed, selectedSubsets, subsetPrefix)
    : ''
  const rolloverCode = generateRolloverTI(params)

  return (
    <div className="flex h-full overflow-hidden">

      {/* Left: subset selector + controls */}
      <div className="flex flex-col gap-4 p-6 w-72 shrink-0 border-r border-border overflow-y-auto">

        <div className="flex flex-col gap-1">
          <label className="text-xs text-muted-foreground font-medium">Subset prefix</label>
          <input
            type="text"
            placeholder="e.g. GBL  →  GBL YTD"
            value={subsetPrefix}
            onChange={e => onPrefixChange(e.target.value)}
            className="bg-input border border-border rounded px-2 py-1.5 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <p className="text-xs text-muted-foreground font-medium mb-1">Subsets to generate</p>
          {SUBSET_DEFS.map(({ id, label, requiresCurrent }) => {
            const disabled = requiresCurrent && !currentAttrEnabled
            const checked  = selectedSubsets.includes(id)
            return (
              <label
                key={id}
                className={cn(
                  'flex items-center gap-2 text-sm cursor-pointer select-none',
                  disabled && 'opacity-40 cursor-not-allowed'
                )}
                title={disabled ? 'Enable "Is Current Period" attribute in Step 1' : undefined}
              >
                <input
                  type="checkbox"
                  checked={checked}
                  disabled={disabled}
                  onChange={() => toggle(id)}
                  className="accent-primary"
                />
                <span>{label}</span>
                {requiresCurrent && (
                  <span className="ml-auto text-[10px] text-muted-foreground">dynamic</span>
                )}
              </label>
            )
          })}
        </div>

        {!currentAttrEnabled && (
          <p className="text-xs text-amber-500 leading-snug">
            Dynamic subsets are disabled. Enable "Is Current Period" attribute in Step 1.
          </p>
        )}

        <div className="mt-auto flex flex-col gap-2 pt-4 border-t border-border">
          <button
            onClick={() => onGenerate('dev')}
            disabled={generating}
            className="w-full px-3 py-2 bg-primary text-primary-foreground text-sm rounded hover:bg-primary/90 disabled:opacity-50 font-medium"
          >
            {generating ? 'Running…' : 'Run on Dev Server'}
          </button>
          <div className="grid grid-cols-3 gap-2">
            {[
              { id: 'build',    label: 'Build TI' },
              { id: 'subsets',  label: 'Subsets TI', disabled: selectedSubsets.length === 0 },
              { id: 'rollover', label: 'Rollover TI' },
            ].map(({ id, label, disabled }) => (
              <button
                key={id}
                onClick={() => setPreview(preview === id ? null : id)}
                disabled={disabled}
                className={cn(
                  'px-2 py-1.5 text-xs rounded border border-border disabled:opacity-40',
                  preview === id ? 'bg-muted text-foreground' : 'text-muted-foreground hover:bg-muted'
                )}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Right: TI code preview */}
      <div className="flex-1 min-w-0 overflow-hidden">
        {preview ? (
          <div className="h-full flex flex-col">
            <div className="px-4 py-2 border-b border-border text-xs text-muted-foreground flex items-center justify-between">
              <span>
              {preview === 'build'    && `${params.dimensionName}.BuildDimension`}
              {preview === 'subsets'  && `${params.dimensionName}.RefreshSubsets`}
              {preview === 'rollover' && `${params.dimensionName}.Rollover`}
            </span>
              <button
                onClick={() => {
                  const code = preview === 'build' ? buildCode : preview === 'subsets' ? subsetsCode : rolloverCode
                  navigator.clipboard?.writeText(code)
                }}
                className="text-muted-foreground hover:text-foreground"
              >
                Copy
              </button>
            </div>
            <pre className="flex-1 overflow-auto p-4 text-xs font-mono text-foreground bg-background leading-relaxed whitespace-pre">
              {preview === 'build'    && buildCode}
              {preview === 'subsets'  && subsetsCode}
              {preview === 'rollover' && rolloverCode}
            </pre>
          </div>
        ) : (
          <div className="h-full flex items-center justify-center text-muted-foreground text-sm">
            Select "Preview Build TI" or "Preview Subsets TI" to inspect the generated code
          </div>
        )}
      </div>
    </div>
  )
}
