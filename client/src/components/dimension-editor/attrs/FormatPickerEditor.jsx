import { useEffect, useImperativeHandle, useRef, useState, forwardRef } from 'react'
import { cn } from '@/lib/utils'
import { COLOUR_HEX, TM1_FORMAT_PRESETS } from '@/lib/dimension-editor/constants'

const FormatPickerEditor = forwardRef(({ value: initialValue, stopEditing }, ref) => {
  const valueRef = useRef(initialValue ?? '')
  const [value, setValue] = useState(initialValue ?? '')
  const inputRef = useRef(null)

  useEffect(() => { setTimeout(() => inputRef.current?.select(), 0) }, [])

  useImperativeHandle(ref, () => ({
    getValue: () => valueRef.current,
    isCancelBeforeStart: () => false,
  }))

  const set = (fmt) => { valueRef.current = fmt; setValue(fmt) }
  const selectPreset = (fmt) => { set(fmt); stopEditing?.() }

  return (
    <div className="bg-popover border border-border rounded shadow-xl p-2 w-64 text-xs" style={{ zIndex: 9999 }}>
      <input ref={inputRef} value={value} onChange={e => set(e.target.value)}
        onKeyDown={e => e.key === 'Enter' && stopEditing?.()}
        placeholder="TM1 format string…"
        className="w-full bg-background border border-border rounded px-2 py-1 mb-2 font-mono text-xs outline-none focus:border-primary" />
      <div className="space-y-1.5 max-h-56 overflow-auto">
        {TM1_FORMAT_PRESETS.map(({ group, items }) => (
          <div key={group}>
            <div className="text-[9px] uppercase tracking-wider text-muted-foreground/60 font-semibold px-0.5 mb-0.5">{group}</div>
            <div className="flex flex-wrap gap-1">
              {items.map(({ fmt, label }) => (
                <button key={fmt} onClick={() => selectPreset(fmt)}
                  className={cn('px-1.5 py-0.5 rounded border text-[10px] font-mono transition-colors',
                    value === fmt
                      ? 'bg-primary text-primary-foreground border-primary'
                      : 'border-border text-muted-foreground hover:bg-muted hover:text-foreground')}
                  title={fmt}>
                  {label}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
      {value.startsWith('@') && (
        <div className="mt-2">
          <div className="text-[9px] uppercase tracking-wider text-muted-foreground/60 font-semibold mb-1">Text Colour</div>
          <div className="flex flex-wrap gap-1 items-center">
            {['red','blue','green','orange','purple','grey','maroon','teal'].map(c => (
              <button key={c} onClick={() => { valueRef.current = `@${c}`; setValue(`@${c}`) }}
                className={cn('w-5 h-5 rounded border transition-colors', value === `@${c}` && 'ring-2 ring-primary')}
                style={{ backgroundColor: c }} title={c} />
            ))}
            <input type="color" value={COLOUR_HEX.test(value.slice(1)) ? value.slice(1) : '#888888'}
              onChange={e => { const v = `@${e.target.value}`; valueRef.current = v; setValue(v) }}
              className="w-6 h-5 p-0 border border-border rounded cursor-pointer" title="Custom colour" />
          </div>
        </div>
      )}
    </div>
  )
})
FormatPickerEditor.displayName = 'FormatPickerEditor'

export default FormatPickerEditor
