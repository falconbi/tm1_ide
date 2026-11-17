import { X } from 'lucide-react'
import { cn } from '@/lib/utils'

// A stable header component: AG Grid rebuilds the header when its type changes,
// and a type that changes on every render interrupts a column resize mid-drag.
export default function AttrHeader({ column }) {
  const colDef = column.getColDef()
  const attr   = colDef.attrDef
  if (!attr) return <span className="truncate">{colDef.headerName}</span>
  const { name, type } = attr
  return (
    <div className="relative flex items-center gap-1 w-full h-full group">
      <span className="flex-1 truncate">{name}</span>
      <span className={cn('text-[8px] font-bold shrink-0',
        type === 'Numeric' ? 'text-sky-400/70' : type === 'Alias' ? 'text-amber-400/70' : 'text-muted-foreground/50')}>
        {type === 'Numeric' ? 'N' : type === 'Alias' ? 'A' : 'S'}
      </span>
      {type === 'String' && !['Format', 'Picklist'].includes(name) && (
        <button onClick={() => colDef.onConvertAttr?.(name)}
          className="opacity-0 group-hover:opacity-100 text-amber-500 hover:text-amber-400 transition-opacity text-[8px] font-bold leading-none"
          title={`Convert ${name} to Alias type`}>
          →A
        </button>
      )}
      <button onClick={() => colDef.onDeleteAttr?.(name)}
        className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-red-400 transition-opacity"
        title={`Delete attribute ${name}`}>
        <X size={10} />
      </button>
    </div>
  )
}
