import { useState } from 'react'
import { Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'

// One confirmation pattern for destructive admin actions: the first click asks,
// the second performs. Used for maintenance, kick, cancel job and cancel thread.
export default function ConfirmButton({
  label,
  message,
  onConfirm,
  disabled = false,
  pending = false,
  title,
  className,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  confirmClassName,
}) {
  const [asking, setAsking] = useState(false)

  if (asking) {
    return (
      <div className="flex flex-col items-end gap-1">
        {message && <span className="max-w-[260px] text-right text-[10px] text-amber-400">{message}</span>}
        <div className="flex items-center gap-1">
          <button
            onClick={async () => { await onConfirm(); setAsking(false) }}
            disabled={disabled || pending}
            className={cn('px-2 py-0.5 text-[10px] rounded bg-red-600 text-white hover:bg-red-500 disabled:opacity-40', confirmClassName)}
          >
            {pending ? <Loader2 size={10} className="animate-spin" /> : confirmLabel}
          </button>
          <button
            onClick={() => setAsking(false)}
            disabled={pending}
            className="px-2 py-0.5 text-[10px] rounded border border-border text-muted-foreground hover:bg-muted disabled:opacity-40"
          >
            {cancelLabel}
          </button>
        </div>
      </div>
    )
  }

  return (
    <button onClick={() => setAsking(true)} disabled={disabled} title={title} className={className}>
      {label}
    </button>
  )
}
