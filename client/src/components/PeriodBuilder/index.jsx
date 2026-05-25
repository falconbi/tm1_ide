import { useState, useEffect, useMemo } from 'react'
import { X, ChevronRight, ChevronLeft } from 'lucide-react'
import { useStore } from '@/store'
import { computeDimension } from './lib/computeDimension.js'
import { SUBSET_DEFS } from './lib/subsetDefs.js'
import {
  generateBuildDimensionSections,
  generateRefreshSubsetsSections,
  generateRolloverSections,
} from './lib/generateTI.js'
import Step1Parameters from './Step1Parameters.jsx'
import Step2Preview from './Step2Preview.jsx'
import Step3Subsets from './Step3Subsets.jsx'

const DEFAULT_PARAMS = {
  dimensionName: 'GBL Period',
  fyStartMonth: 4,
  firstCalYear: new Date().getFullYear() - 2,
  lastCalYear: new Date().getFullYear() + 8,
  yearFormat: 'fy-end',
  monthFormat: 'YYYY-MM',
  captionFormat: 'Mon-YY',
  longNameFormat: 'Month YYYY',
  includeTotal: false,
  partialBoundary: 'include',
  includeCurrentPeriodAttr: true,
}

const STEPS = ['Parameters', 'FY Preview', 'Subsets & Output']

export default function PeriodBuilder({ open, onClose }) {
  const { server } = useStore()

  const [step, setStep]                 = useState(0)
  const [params, setParams]             = useState(DEFAULT_PARAMS)
  const [selectedSubsets, setSubsets]   = useState(
    SUBSET_DEFS.filter(d => d.defaultOn).map(d => d.id)
  )
  const [subsetPrefix, setSubsetPrefix] = useState('')
  const [generating, setGenerating]     = useState(false)
  const [result, setResult]             = useState(null)

  // Re-filter selected subsets when Is Current Period toggled off
  useEffect(() => {
    if (!params.includeCurrentPeriodAttr) {
      setSubsets(prev => prev.filter(id => {
        const def = SUBSET_DEFS.find(d => d.id === id)
        return !def?.requiresCurrent
      }))
    }
  }, [params.includeCurrentPeriodAttr])

  useEffect(() => {
    if (!open) return
    const onKey = (e) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onClose])

  const computed = useMemo(() => {
    try { return computeDimension(params) }
    catch { return null }
  }, [params])

  if (!open) return null

  const canNext = step < STEPS.length - 1
  const canBack = step > 0

  const handleGenerate = async () => {
    if (!server || !computed) return
    setGenerating(true)
    setResult(null)
    try {
      const buildSections    = generateBuildDimensionSections(params, computed)
      const subsetsSections  = generateRefreshSubsetsSections(params, computed, selectedSubsets, subsetPrefix)
      const rolloverSections = generateRolloverSections(params)

      const processes = [
        { name: `${params.dimensionName}.BuildDimension`,  ...buildSections,    parameters: [] },
        { name: `${params.dimensionName}.RefreshSubsets`,  ...subsetsSections,  parameters: [] },
        { name: `${params.dimensionName}.Rollover`,        ...rolloverSections },
      ]

      const res = await fetch('/api/period-builder/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          server,
          dimensionName: params.dimensionName,
          processes,
          elements: computed.elements,
          edges:    computed.edges,
        }),
      })
      const data = await res.json()
      setResult(data.ok
        ? { ok: true,  message: `${params.dimensionName} built on ${server} — 3 processes created` }
        : { ok: false, message: data.error ?? 'Unknown error' }
      )
    } catch (e) {
      setResult({ ok: false, message: e.message })
    } finally {
      setGenerating(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="bg-card border border-border rounded-lg shadow-2xl flex flex-col overflow-hidden"
        style={{ width: 860, height: 560 }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center gap-4 px-6 py-3 border-b border-border shrink-0">
          <span className="font-semibold text-sm">Period Dimension Builder</span>

          {/* Step indicators */}
          <div className="flex items-center gap-1 ml-2">
            {STEPS.map((label, i) => (
              <div key={i} className="flex items-center gap-1">
                {i > 0 && <ChevronRight size={12} className="text-muted-foreground" />}
                <button
                  onClick={() => i < step && setStep(i)}
                  className={`text-xs px-2 py-0.5 rounded ${
                    i === step
                      ? 'bg-primary text-primary-foreground font-medium'
                      : i < step
                        ? 'text-muted-foreground hover:text-foreground cursor-pointer'
                        : 'text-muted-foreground/40 cursor-default'
                  }`}
                >
                  {label}
                </button>
              </div>
            ))}
          </div>

          <button
            onClick={onClose}
            className="ml-auto p-1 rounded text-muted-foreground hover:text-foreground hover:bg-muted"
          >
            <X size={15} />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 min-h-0 overflow-hidden">
          {step === 0 && (
            <div className="h-full overflow-y-auto">
              <Step1Parameters params={params} onChange={setParams} />
            </div>
          )}
          {step === 1 && computed && (
            <Step2Preview params={params} computed={computed} />
          )}
          {step === 2 && computed && (
            <Step3Subsets
              params={params}
              computed={computed}
              selectedSubsets={selectedSubsets}
              onSubsetsChange={setSubsets}
              subsetPrefix={subsetPrefix}
              onPrefixChange={setSubsetPrefix}
              onGenerate={() => handleGenerate()}
              generating={generating}
            />
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center gap-3 px-6 py-3 border-t border-border shrink-0">
          {result && (
            <span className={`text-xs ${result.ok ? 'text-green-500' : 'text-red-400'}`}>
              {result.message}
            </span>
          )}
          <div className="ml-auto flex gap-2">
            {canBack && (
              <button
                onClick={() => setStep(s => s - 1)}
                className="flex items-center gap-1 px-3 py-1.5 text-sm rounded border border-border text-muted-foreground hover:text-foreground hover:bg-muted"
              >
                <ChevronLeft size={14} /> Back
              </button>
            )}
            {canNext && (
              <button
                onClick={() => setStep(s => s + 1)}
                disabled={!computed}
                className="flex items-center gap-1 px-3 py-1.5 text-sm rounded bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
              >
                Next <ChevronRight size={14} />
              </button>
            )}
            {!canNext && (
              <button
                onClick={onClose}
                className="px-3 py-1.5 text-sm rounded border border-border text-muted-foreground hover:text-foreground hover:bg-muted"
              >
                Close
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
