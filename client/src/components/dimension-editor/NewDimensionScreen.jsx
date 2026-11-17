import { useState, useRef, useEffect } from 'react'
import { toast } from 'sonner'
import { useCreateDimension } from '@/hooks/useApi'
import { useStore } from '@/store'

export default function NewDimensionScreen({ tab }) {
  const [name, setName] = useState('')
  const createMut = useCreateDimension()
  const { patchTab } = useStore()
  const inputRef = useRef(null)
  useEffect(() => { setTimeout(() => inputRef.current?.focus(), 50) }, [])

  const handleCreate = () => {
    const n = name.trim()
    if (!n) return
    const id = toast.loading(`Creating "${n}"…`)
    createMut.mutate({ server: tab.server, name: n }, {
      onSuccess: () => {
        toast.success(`Created ${n}`, { id })
        patchTab(tab.id, { dimension: n, hierarchy: n, label: n })
      },
      onError: (err) => toast.error(err.message ?? 'Create failed', { id }),
    })
  }

  return (
    <div className="flex flex-col items-center justify-center h-full gap-4 text-sm">
      <div className="font-semibold text-base">New Dimension</div>
      <div className="flex gap-2 w-72">
        <input
          ref={inputRef}
          value={name}
          onChange={e => setName(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') handleCreate() }}
          placeholder="Dimension name…"
          className="flex-1 px-3 py-1.5 text-sm border rounded bg-background outline-none focus:border-primary font-mono"
        />
        <button onClick={handleCreate} disabled={!name.trim() || createMut.isPending}
          className="px-3 py-1.5 text-sm rounded bg-primary text-primary-foreground disabled:opacity-40">
          {createMut.isPending ? 'Creating…' : 'Create'}
        </button>
      </div>
    </div>
  )
}
