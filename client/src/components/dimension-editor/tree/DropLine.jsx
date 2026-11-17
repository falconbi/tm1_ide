import { useState } from 'react'
import { cn } from '@/lib/utils'

// ── Drop line between siblings (drag to place before) ───────────────────────
export default function DropLine({ onDrop }) {
  const [over, setOver] = useState(false)
  return (
    <div
      onDragOver={e => { e.preventDefault(); e.stopPropagation(); e.dataTransfer.dropEffect = 'move'; setOver(true) }}
      onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget)) setOver(false) }}
      onDrop={e => {
        e.preventDefault(); e.stopPropagation(); setOver(false)
        onDrop(e.dataTransfer.getData('text/plain'))
      }}
      className={cn('h-1.5 mx-1 rounded-full transition-colors', over ? 'bg-primary' : 'bg-transparent')}
    />
  )
}
