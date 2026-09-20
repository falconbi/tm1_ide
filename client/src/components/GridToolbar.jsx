/**
 * GridToolbar — compact control strip for the cube data grids.
 *
 * Provides: fit-to-content, reset column widths, freeze-top-row toggle,
 * in-grid quick search (Ctrl+F), optional CSV export, and a grid-appearance
 * popover (row height, font size, zebra, number format, consolidation emphasis).
 *
 * Props:
 *   apiRef           ref → { current: { api } }  (used for default fit/reset/export)
 *   onFit            optional — override fit behaviour
 *   onReset          optional — grid handles clearing its own saved widths
 *   onSearch(text)   sets the grid's quick filter
 *   showCsv / onCsv  optional CSV export button
 *   showFreeze       default true
 *   frozen           freeze-top-row state
 *   onToggleFreeze
 *   appearance       { settings, patch } from useGridAppearance() — renders the format popover
 *   right            extra node rendered on the right
 */

import { useEffect, useRef, useState } from 'react'
import { Search, X, Maximize2, RefreshCw, Pin, PinOff, Download, Palette, Check } from 'lucide-react'
import { cn } from '@/lib/utils'

const BTN = 'flex items-center gap-1 px-1.5 py-0.5 rounded border border-border hover:bg-muted transition-colors text-muted-foreground hover:text-foreground'

function Segmented({ value, options, onChange }) {
  return (
    <div className="flex items-center gap-0.5">
      {options.map(o => (
        <button
          key={o.value}
          onClick={() => onChange(o.value)}
          title={o.label}
          className={cn(
            'px-1.5 py-0.5 rounded text-[10px] transition-colors',
            value === o.value ? 'text-primary bg-primary/10' : 'text-muted-foreground hover:bg-muted'
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

function Toggle({ label, checked, onChange }) {
  return (
    <button
      onClick={() => onChange(!checked)}
      className={cn('flex items-center gap-1.5 text-left py-0.5 group', checked ? 'text-primary' : 'text-muted-foreground')}
    >
      <span className={cn('w-3.5 h-3.5 rounded border flex items-center justify-center shrink-0 transition-colors',
        checked ? 'bg-primary border-primary' : 'border-border group-hover:border-primary/50')}>
        {checked && <Check size={10} className="text-primary-foreground" />}
      </span>
      <span>{label}</span>
    </button>
  )
}

function AppearancePopover({ appearance }) {
  const { settings, patch } = appearance
  const [open, setOpen] = useState(false)
  const ref = useRef(null)

  useEffect(() => {
    if (!open) return
    const close = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [open])

  return (
    <div className="relative" ref={ref}>
      <button
        className={cn(BTN, open && 'text-primary bg-primary/10 border-primary/40')}
        onClick={() => setOpen(v => !v)}
        title="Grid format options"
      >
        <Palette size={10} /> Format
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 z-30 w-52 bg-popover border border-border rounded shadow-xl p-2.5 flex flex-col gap-2 text-[10px]">
          <div className="flex items-center justify-between gap-2">
            <span className="text-muted-foreground">Row height</span>
            <Segmented
              value={settings.rowHeight}
              onChange={v => patch('rowHeight', v)}
              options={[{ value: 'compact', label: 'Compact' }, { value: 'comfortable', label: 'Comfortable' }]}
            />
          </div>
          <div className="flex items-center justify-between gap-2">
            <span className="text-muted-foreground">Font size</span>
            <Segmented
              value={settings.fontSize}
              onChange={v => patch('fontSize', v)}
              options={[10, 12, 14].map(s => ({ value: s, label: String(s) }))}
            />
          </div>
          <div className="border-t border-border my-0.5" />
          <Toggle label="Zebra striping" checked={settings.zebra} onChange={v => patch('zebra', v)} />
          <Toggle label="Number format (TM1 format strings)" checked={settings.numFormat} onChange={v => patch('numFormat', v)} />
          <Toggle label="Highlight consolidations" checked={settings.consEmphasis} onChange={v => patch('consEmphasis', v)} />
        </div>
      )}
    </div>
  )
}

export default function GridToolbar({
  apiRef,
  onFit,
  onReset,
  onSearch,
  showCsv = false,
  onCsv,
  showFreeze = true,
  frozen = false,
  onToggleFreeze,
  appearance,
  right,
  placeholder = 'Search grid (Ctrl+F)',
  className,
}) {
  const [search, setSearch] = useState('')
  const inputRef = useRef(null)

  useEffect(() => {
    const onKey = (e) => {
      const ae = document.activeElement
      const typing = ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA' || ae.isContentEditable)

      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && (e.key === 'f' || e.key === 'F')) {
        if (typing) return
        e.preventDefault()
        inputRef.current?.focus()
        inputRef.current?.select()
      }
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === 'a' || e.key === 'A')) {
        if (typing) return
        e.preventDefault()
        if (onFit) onFit()
        else apiRef?.current?.api?.autoSizeAllColumns?.()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [apiRef, onFit])

  const handleFit = () => {
    if (onFit) onFit()
    else apiRef?.current?.api?.autoSizeAllColumns?.()
  }

  const handleReset = () => {
    if (onReset) { onReset(); return }
    apiRef?.current?.api?.resetColumnWidths?.()
    apiRef?.current?.api?.autoSizeAllColumns?.()
  }

  return (
    <div className={cn('flex items-center gap-1.5 px-2 py-1 border-b border-border shrink-0 text-[10px]', className)}>
      <button className={BTN} onClick={handleFit} title="Fit columns to content (Ctrl+Shift+A)">
        <Maximize2 size={10} /> Fit
      </button>
      <button className={BTN} onClick={handleReset} title="Reset column widths to default">
        <RefreshCw size={10} /> Reset
      </button>
      {showFreeze && (
        <button
          className={cn(BTN, frozen && 'text-primary bg-primary/10 border-primary/40')}
          onClick={onToggleFreeze}
          title={frozen ? 'Unfreeze top row' : 'Freeze top row pinned while scrolling'}
        >
          {frozen ? <PinOff size={10} /> : <Pin size={10} />} {frozen ? 'Unfreeze' : 'Freeze top'}
        </button>
      )}
      {appearance && <AppearancePopover appearance={appearance} />}
      <div className="relative flex-1 max-w-[240px] min-w-[110px]">
        <Search size={10} className="absolute left-1.5 top-1/2 -translate-y-1/2 text-muted-foreground/60 pointer-events-none" />
        <input
          ref={inputRef}
          value={search}
          onChange={(e) => { setSearch(e.target.value); onSearch?.(e.target.value) }}
          placeholder={placeholder}
          className="w-full pl-5 pr-5 py-0.5 text-[10px] rounded border border-border bg-background focus:outline-none focus:border-primary"
        />
        {search && (
          <button
            className="absolute right-1 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            onClick={() => { setSearch(''); onSearch?.(''); inputRef.current?.focus() }}
            title="Clear search"
          >
            <X size={10} />
          </button>
        )}
      </div>
      <div className="flex items-center gap-1.5 ml-auto">{right}</div>
      {showCsv && onCsv && (
        <button className={BTN} onClick={onCsv} title="Export grid to CSV">
          <Download size={10} /> CSV
        </button>
      )}
    </div>
  )
}