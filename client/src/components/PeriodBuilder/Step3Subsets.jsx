import { useState } from 'react'
import { SUBSET_DEFS } from './lib/subsetDefs.js'
import { generateBuildDimensionTI, generateRefreshSubsetsTI, generateRolloverTI } from './lib/generateTI.js'
import { cn } from '@/lib/utils'
import { Maximize2, Minimize2, Copy } from 'lucide-react'

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
  const [preview, setPreview] = useState(null)
  const [fullscreen, setFullscreen] = useState(false)

  const toggle = (id) => {
    if (selectedSubsets.includes(id)) {
      onSubsetsChange(selectedSubsets.filter(s => s !== id))
    } else {
      onSubsetsChange([...selectedSubsets, id])
    }
  }

  const highlightTI = (code) => {
    return code
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/(#.*)/g, '<span class="text-emerald-500">$1</span>')
      .replace(/\b(IF|ELSEIF|ELSE|ENDIF|WHILE|END|THEN)\b/g, '<span class="text-amber-400">$1</span>')
      .replace(/\b(DimensionCreate|DimensionDestroy|DimensionElementInsert|DimensionElementComponentAdd|DIMIX|DimSiz|DimNm|ElementLevel|AttrInsert|ElementAttrPutS|ElementAttrPutN|AttrPutS|AttrPutN|SubsetCreate|SubsetAlia(Set|sDestroy|ElementInsert)|ExecuteProcess|ParseDate|NewDateFormatter)\b/g, '<span class="text-sky-400">$1</span>')
      .replace(/\b(MOD|DATE|NOW|TODAY|NumberToString|StringToNumber|SUBST|TRIM|SCAN|LONG|UPPER|LOWER|INT|ROUND|SQRT|DAYNO|ASCIIOutput|ProcessQuit)\b/g, '<span class="text-violet-400">$1</span>')
      .replace(/(\b\d+\b)/g, '<span class="text-orange-300">$1</span>')
      .replace(/('[^']*')/g, '<span class="text-green-400">$1</span>')
      .replace(/\b(pDimension|pFirstFY|pLastFY|pFYStartM|nFmt)\b/g, '<span class="text-rose-300">$1</span>')
  }

  const buildCode    = generateBuildDimensionTI(params, selectedSubsets)
  const subsetsCode  = selectedSubsets.length > 0
    ? generateRefreshSubsetsTI(params, selectedSubsets, subsetPrefix)
    : ''
  const rolloverCode = generateRolloverTI(params)

  return (
    <>
    <div className="flex h-full overflow-hidden">

      {/* Left: subset selector + controls */}
      <div className="flex flex-col gap-4 p-6 w-72 shrink-0 border-r border-border overflow-y-auto">

        <div className="flex flex-col gap-1">
          <label className="text-xs text-muted-foreground font-medium">Subset prefix</label>
          <input
            type="text"
            placeholder="e.g. GBL  ->  GBL YTD"
            value={subsetPrefix}
            onChange={e => onPrefixChange(e.target.value)}
            className="bg-input border border-border rounded px-2 py-1.5 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <p className="text-xs text-muted-foreground font-medium mb-1">Subsets to generate</p>
          {SUBSET_DEFS.map(({ id, label, requiresCurrent }) => {
            const disabled = requiresCurrent && false
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

        <div className="mt-auto flex flex-col gap-2 pt-4 border-t border-border">
          <button
            onClick={() => onGenerate()}
            disabled={generating}
            className="w-full px-3 py-2 bg-primary text-primary-foreground text-sm rounded hover:bg-primary/90 disabled:opacity-50 font-medium"
          >
            {generating ? 'Saving...' : 'Create Period TI Processes'}
          </button>
        </div>
      </div>

      {/* Right: TI code preview */}
      <div className="flex-1 min-w-0 flex flex-col overflow-hidden">
        <div className="flex items-center gap-1 px-4 py-2 border-b border-border shrink-0">
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
                'px-2.5 py-1 text-xs rounded border border-border disabled:opacity-40',
                preview === id ? 'bg-muted text-foreground' : 'text-muted-foreground hover:bg-muted'
              )}
            >
              {label}
            </button>
          ))}
        </div>
        {preview ? (
          <div className="flex-1 flex flex-col min-h-0">
            <div className="px-4 py-1.5 border-b border-border text-xs text-muted-foreground flex items-center justify-between shrink-0">
              <span>
                {preview === 'build'    && `${params.dimensionName}.Build Period Dimension`}
                {preview === 'subsets'  && `${params.dimensionName}.Refresh Subsets`}
                {preview === 'rollover' && `${params.dimensionName}.Rollover`}
              </span>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => {
                    const code = preview === 'build' ? buildCode : preview === 'subsets' ? subsetsCode : rolloverCode
                    navigator.clipboard?.writeText(code)
                  }}
                  className="text-muted-foreground hover:text-foreground"
                  title="Copy"
                >
                  <Copy size={13} />
                </button>
                <button
                  onClick={() => setFullscreen(true)}
                  className="text-muted-foreground hover:text-foreground"
                  title="Full screen"
                >
                  <Maximize2 size={13} />
                </button>
              </div>
            </div>
            <pre className="flex-1 overflow-auto p-4 text-xs font-mono leading-relaxed whitespace-pre bg-background">
              <code dangerouslySetInnerHTML={{ __html:
                preview === 'build'    ? highlightTI(buildCode)
                : preview === 'subsets' ? highlightTI(subsetsCode)
                : highlightTI(rolloverCode)
              }} />
            </pre>
          </div>
        ) : (
          <div className="flex-1 flex items-center justify-center text-muted-foreground text-sm">
            Select a tab above to preview the generated TI code
          </div>
        )}
      </div>
    </div>

    {fullscreen && preview && (
      <div className="fixed inset-0 z-50 bg-background flex flex-col">
        <div className="px-4 py-2 border-b border-border text-xs text-muted-foreground flex items-center justify-between shrink-0">
          <span>
            {preview === 'build'    && `${params.dimensionName}.Build Period Dimension`}
            {preview === 'subsets'  && `${params.dimensionName}.Refresh Subsets`}
            {preview === 'rollover' && `${params.dimensionName}.Rollover`}
          </span>
          <div className="flex items-center gap-2">
            <button
              onClick={() => {
                const code = preview === 'build' ? buildCode : preview === 'subsets' ? subsetsCode : rolloverCode
                navigator.clipboard?.writeText(code)
              }}
              className="text-muted-foreground hover:text-foreground"
              title="Copy"
            >
              <Copy size={14} />
            </button>
            <button
              onClick={() => setFullscreen(false)}
              className="text-muted-foreground hover:text-foreground"
              title="Exit full screen"
            >
              <Minimize2 size={14} />
            </button>
          </div>
        </div>
        <pre className="flex-1 overflow-auto p-6 text-sm font-mono leading-relaxed whitespace-pre bg-background">
          <code dangerouslySetInnerHTML={{ __html:
            preview === 'build'    ? highlightTI(buildCode)
            : preview === 'subsets' ? highlightTI(subsetsCode)
            : highlightTI(rolloverCode)
          }} />
        </pre>
      </div>
    )}
    </>
  )
}
