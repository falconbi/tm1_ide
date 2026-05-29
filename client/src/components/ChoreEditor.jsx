import { useState, useEffect } from 'react'
import { useChore, useSaveChore, useProcs } from '@/hooks/useApi'
import { useStore } from '@/store'
import { toast } from 'sonner'
import { Plus, Trash2, ChevronUp, ChevronDown, Clock, Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'

// ── Helpers ───────────────────────────────────────────────────────────────────

function parseFreq(f) {
  if (!f) return { Days: 0, Hours: 0, Minutes: 0, Seconds: 0 }
  // PA returns either numbers or strings like "P0DT01H00M00S"
  if (typeof f.Days === 'number') return { Days: f.Days, Hours: f.Hours, Minutes: f.Minutes, Seconds: f.Seconds }
  // fallback: parse duration string
  const m = String(f).match(/P(\d+)DT(\d+)H(\d+)M(\d+)S/)
  return m ? { Days: +m[1], Hours: +m[2], Minutes: +m[3], Seconds: +m[4] } : { Days: 0, Hours: 0, Minutes: 0, Seconds: 0 }
}

function formatStartTime(iso) {
  if (!iso) return { date: '', time: '' }
  const [date, timePart] = iso.replace('Z', '').split('T')
  return { date: date ?? '', time: (timePart ?? '').slice(0, 5) }
}

function buildStartTime(date, time) {
  return `${date}T${time}:00`
}

// ── Step row ──────────────────────────────────────────────────────────────────

function StepRow({ step, index, total, procs, onChange, onRemove, onMoveUp, onMoveDown }) {
  const base = 'w-full bg-muted border border-border rounded px-2 py-1 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-ring'

  return (
    <div className="border border-border rounded-md p-3 space-y-2 bg-muted/20">
      <div className="flex items-center gap-2">
        <span className="text-xs text-muted-foreground font-mono w-5 shrink-0">{index + 1}.</span>
        <select
          value={step.Process?.Name ?? ''}
          onChange={e => onChange({ ...step, Process: { Name: e.target.value }, Parameters: [] })}
          className={cn(base, 'flex-1')}
        >
          <option value="">— select process —</option>
          {(procs ?? []).map(p => <option key={p} value={p}>{p}</option>)}
        </select>
        <button onClick={onMoveUp}   disabled={index === 0}         title="Move up"   className="p-1 text-muted-foreground hover:text-foreground disabled:opacity-30"><ChevronUp   size={12} /></button>
        <button onClick={onMoveDown} disabled={index === total - 1} title="Move down" className="p-1 text-muted-foreground hover:text-foreground disabled:opacity-30"><ChevronDown size={12} /></button>
        <button onClick={onRemove}   title="Remove step" className="p-1 text-muted-foreground hover:text-red-400"><Trash2 size={12} /></button>
      </div>

      {(step.Parameters ?? []).length > 0 && (
        <div className="pl-7 space-y-1">
          {step.Parameters.map((p, pi) => (
            <div key={p.Name} className="flex items-center gap-2">
              <span className="text-[10px] text-muted-foreground font-mono w-28 shrink-0 truncate" title={p.Name}>{p.Name}</span>
              <input
                type="text"
                value={p.Value ?? ''}
                onChange={e => {
                  const updated = step.Parameters.map((pp, i) => i === pi ? { ...pp, Value: e.target.value } : pp)
                  onChange({ ...step, Parameters: updated })
                }}
                className={base}
              />
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Main editor ───────────────────────────────────────────────────────────────

export default function ChoreEditor({ tab }) {
  const { server, name } = tab
  const { dark } = useStore()
  const { data, isLoading } = useChore(server, name)
  const saveChore = useSaveChore()
  const { data: procs } = useProcs(server)

  const [active,   setActive]   = useState(true)
  const [execMode, setExecMode] = useState('SingleCommit')
  const [freqDays, setFreqDays] = useState(0)
  const [freqHrs,  setFreqHrs]  = useState(0)
  const [freqMins, setFreqMins] = useState(0)
  const [freqSecs, setFreqSecs] = useState(0)
  const [startDate, setStartDate] = useState('')
  const [startTime, setStartTime] = useState('09:00')
  const [steps, setSteps] = useState([])
  const [dirty, setDirty] = useState(false)

  useEffect(() => {
    if (!data) return
    setActive(data.Active ?? true)
    setExecMode(data.ExecutionMode ?? 'SingleCommit')
    const freq = parseFreq(data.Frequency)
    setFreqDays(freq.Days)
    setFreqHrs(freq.Hours)
    setFreqMins(freq.Minutes)
    setFreqSecs(freq.Seconds)
    const { date, time } = formatStartTime(data.StartTime)
    setStartDate(date)
    setStartTime(time || '09:00')
    setSteps((data.Steps ?? []).slice().sort((a, b) => a.Ordinal - b.Ordinal))
    setDirty(false)
  }, [data])

  const mark = fn => (...args) => { fn(...args); setDirty(true) }

  const updateStep = mark((i, updated) => setSteps(s => s.map((st, idx) => idx === i ? updated : st)))
  const removeStep = mark(i  => setSteps(s => s.filter((_, idx) => idx !== i)))
  const moveStep   = mark((i, dir) => setSteps(s => {
    const arr = [...s]
    const to = i + dir
    ;[arr[i], arr[to]] = [arr[to], arr[i]]
    return arr
  }))
  const addStep = mark(() => setSteps(s => [...s, { Process: { Name: '' }, Parameters: [] }]))

  const handleSave = () => {
    const body = {
      Active:        active,
      ExecutionMode: execMode,
      StartTime:     buildStartTime(startDate, startTime),
      Frequency:     { Days: +freqDays, Hours: +freqHrs, Minutes: +freqMins, Seconds: +freqSecs },
      Steps: steps.map((st, i) => ({
        Ordinal:    i,
        'Process@odata.bind': `Processes('${encodeURIComponent(st.Process?.Name ?? '')}')`,
        Parameters: (st.Parameters ?? []).map(p => ({ Name: p.Name, Value: String(p.Value ?? '') })),
      })),
    }
    const id = toast.loading('Saving chore…')
    saveChore.mutate({ server, name, body }, {
      onSuccess: () => { toast.success('Chore saved', { id }); setDirty(false) },
      onError:   e  => toast.error(e.message, { id }),
    })
  }

  if (isLoading) return (
    <div className="flex-1 flex items-center justify-center text-muted-foreground text-sm gap-2">
      <Loader2 size={14} className="animate-spin" /> Loading chore…
    </div>
  )

  const numInput = 'w-16 bg-muted border border-border rounded px-2 py-1 text-xs font-mono text-center focus:outline-none focus:ring-1 focus:ring-ring'
  const label    = 'text-xs text-muted-foreground'

  return (
    <div className="flex flex-col h-full overflow-hidden">

      {/* Toolbar */}
      <div className="flex items-center gap-3 px-4 py-2 border-b border-border bg-muted shrink-0">
        <Clock size={13} className="text-muted-foreground shrink-0" />
        <span className="text-sm font-medium truncate flex-1">{name}</span>

        {/* Active toggle */}
        <button
          onClick={() => { setActive(a => !a); setDirty(true) }}
          className={cn(
            'flex items-center gap-1.5 px-3 py-1 text-xs rounded border transition-colors',
            active
              ? 'bg-green-600/20 border-green-600/50 text-green-400'
              : 'bg-muted border-border text-muted-foreground'
          )}
        >
          <span className={cn('w-1.5 h-1.5 rounded-full', active ? 'bg-green-400' : 'bg-muted-foreground')} />
          {active ? 'Active' : 'Inactive'}
        </button>

        <button
          onClick={handleSave}
          disabled={!dirty || saveChore.isPending}
          className="px-3 py-1 text-xs rounded bg-primary text-primary-foreground disabled:opacity-40 hover:opacity-90 transition-opacity"
        >
          {saveChore.isPending ? 'Saving…' : 'Save'}
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-5">

        {/* Schedule */}
        <section>
          <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">Schedule</div>
          <div className="border border-border rounded-md p-3 space-y-3 bg-muted/20">

            <div className="flex items-center gap-4 flex-wrap">
              <div className="flex items-center gap-2">
                <span className={label}>Start date</span>
                <input type="date" value={startDate} onChange={e => { setStartDate(e.target.value); setDirty(true) }}
                  className="bg-muted border border-border rounded px-2 py-1 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-ring" />
              </div>
              <div className="flex items-center gap-2">
                <span className={label}>Time</span>
                <input type="time" value={startTime} onChange={e => { setStartTime(e.target.value); setDirty(true) }}
                  className="bg-muted border border-border rounded px-2 py-1 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-ring" />
              </div>
              <div className="flex items-center gap-2">
                <span className={label}>Mode</span>
                <select value={execMode} onChange={e => { setExecMode(e.target.value); setDirty(true) }}
                  className="bg-muted border border-border rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-ring">
                  <option value="SingleCommit">Single Commit</option>
                  <option value="MultipleCommit">Multiple Commit</option>
                </select>
              </div>
            </div>

            <div className="flex items-center gap-3 flex-wrap">
              <span className={label}>Repeat every</span>
              {[
                { val: freqDays, set: v => { setFreqDays(v); setDirty(true) }, label: 'days' },
                { val: freqHrs,  set: v => { setFreqHrs(v);  setDirty(true) }, label: 'hrs'  },
                { val: freqMins, set: v => { setFreqMins(v); setDirty(true) }, label: 'min'  },
                { val: freqSecs, set: v => { setFreqSecs(v); setDirty(true) }, label: 'sec'  },
              ].map(f => (
                <div key={f.label} className="flex items-center gap-1">
                  <input type="number" min={0} value={f.val} onChange={e => f.set(e.target.value)}
                    className={numInput} />
                  <span className={label}>{f.label}</span>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Steps */}
        <section>
          <div className="flex items-center justify-between mb-2">
            <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Steps <span className="font-mono font-normal normal-case tracking-normal text-muted-foreground/50 ml-1">{steps.length}</span>
            </div>
            <button
              onClick={addStep}
              className="flex items-center gap-1 px-2 py-0.5 text-xs rounded border border-border text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            >
              <Plus size={11} /> Add step
            </button>
          </div>

          {steps.length === 0 ? (
            <p className="text-xs text-muted-foreground italic px-1">No steps — add one above.</p>
          ) : (
            <div className="space-y-2">
              {steps.map((step, i) => (
                <StepRow
                  key={i}
                  step={step}
                  index={i}
                  total={steps.length}
                  procs={procs}
                  onChange={updated => updateStep(i, updated)}
                  onRemove={() => removeStep(i)}
                  onMoveUp={() => moveStep(i, -1)}
                  onMoveDown={() => moveStep(i, 1)}
                />
              ))}
            </div>
          )}
        </section>

      </div>
    </div>
  )
}
