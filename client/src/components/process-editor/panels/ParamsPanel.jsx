import { Trash2, Plus } from 'lucide-react'
import { toTypeStr } from '@/lib/process-editor/constants'

export default function ParamsPanel({ params, onChange }) {
  const cell = 'w-full bg-transparent border-b border-transparent hover:border-border focus:border-primary px-1 py-0.5 font-mono focus:outline-none text-xs'

  const set = (i, field, val) => onChange(params.map((p, idx) => idx === i ? { ...p, [field]: val } : p))
  const add = () => onChange([...params, { Name: 'p', Type: 'String', Value: '', Prompt: '' }])
  const remove = (i) => onChange(params.filter((_, idx) => idx !== i))

  return (
    <div>
      {params.length > 0 && (
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-border bg-muted text-muted-foreground">
              <th className="text-left px-3 py-1.5">Name</th>
              <th className="text-left px-3 py-1.5 w-24">Type</th>
              <th className="text-left px-3 py-1.5">Default</th>
              <th className="text-left px-3 py-1.5">Prompt</th>
              <th className="w-6" />
            </tr>
          </thead>
          <tbody>
            {params.map((p, i) => (
              <tr key={i} className="border-b border-border hover:bg-muted/30 group">
                <td className="px-2 py-0.5">
                  <input value={p.Name ?? ''} onChange={e => set(i, 'Name', e.target.value)} className={cell} />
                </td>
                <td className="px-2 py-0.5">
                  <select
                    value={toTypeStr(p.Type)}
                    onChange={e => set(i, 'Type', e.target.value)}
                    className="w-full bg-transparent text-xs focus:outline-none"
                  >
                    <option value="String">String</option>
                    <option value="Numeric">Numeric</option>
                  </select>
                </td>
                <td className="px-2 py-0.5">
                  <input value={String(p.Value ?? '')} onChange={e => set(i, 'Value', e.target.value)} className={cell} />
                </td>
                <td className="px-2 py-0.5">
                  <input value={p.Prompt ?? ''} onChange={e => set(i, 'Prompt', e.target.value)} className={cell} />
                </td>
                <td className="px-1 py-0.5">
                  <button
                    onClick={() => remove(i)}
                    className="hidden group-hover:flex items-center text-muted-foreground hover:text-red-400 p-0.5"
                  >
                    <Trash2 size={10} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {params.length === 0 && (
        <p className="px-4 py-2 text-xs text-muted-foreground italic">No parameters — click below to add one.</p>
      )}
      <button
        onClick={add}
        className="flex items-center gap-1 w-full px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground hover:bg-muted transition-colors border-t border-border"
      >
        <Plus size={10} /> Add parameter
      </button>
    </div>
  )
}
