import { useState } from 'react'
import {
  ChevronRight, ChevronDown, Layers, X, ArrowRight, Filter,
  Code2, Workflow, Zap, Eye, Columns2,
} from 'lucide-react'

const NO_LENS_USAGE = Object.freeze({})

function Section({ title, count, icon, children, defaultOpen = false }) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div style={{ marginBottom: 6 }}>
      <button onClick={() => setOpen(o => !o)}
        title={open ? `Collapse ${title}` : `Expand ${title}`}
        style={{
          width: '100%', padding: '3px 12px', display: 'flex', alignItems: 'center', gap: 4,
          background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left',
        }}>
        {open ? <ChevronDown size={10} style={{ color: 'var(--cm-text-muted)', flexShrink: 0 }} />
              : <ChevronRight size={10} style={{ color: 'var(--cm-text-muted)', flexShrink: 0 }} />}
        {icon}
        <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--cm-text-muted)', opacity: 0.65 }}>
          {title}
        </span>
        {count !== undefined && (
          <span style={{ fontSize: 10, color: 'var(--cm-text-muted)', opacity: 0.4, marginLeft: 1 }}>{count}</span>
        )}
      </button>
      {open && <div>{children}</div>}
    </div>
  )
}

// A small 'Lens' tag for a process run from a Lens button (lens = the Lens titles using it).
function LensTag({ lens }) {
  if (!lens?.length) return null
  return (
    <span title={`Run from a Lens button — ${lens.join(', ')}`} style={{
      flexShrink: 0, marginLeft: 'auto', fontSize: 9, fontWeight: 600, padding: '0 5px', borderRadius: 3,
      border: '1px solid #6366f1', color: '#6366f1', background: 'rgba(99,102,241,0.12)',
    }}>Lens</span>
  )
}

function FlowItem({ label, onClick, color, icon, lens }) {
  return (
    <button onClick={onClick} style={{
      display: 'flex', alignItems: 'center', gap: 5, width: '100%',
      padding: '3px 12px', background: 'none', border: 'none', cursor: 'pointer',
      textAlign: 'left', fontSize: 11, color: color ?? 'var(--cm-link)',
    }}
      onMouseEnter={e => e.currentTarget.style.background = 'var(--cm-hover)'}
      onMouseLeave={e => e.currentTarget.style.background = 'none'}
    >
      {icon ?? <ArrowRight size={10} style={{ flexShrink: 0 }} />}
      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</span>
      <LensTag lens={lens} />
    </button>
  )
}

function DimItem({ name, active, onClick }) {
  return (
    <button onClick={onClick} style={{
      display: 'flex', alignItems: 'center', gap: 5, width: '100%',
      padding: '3px 12px', border: 'none', cursor: 'pointer', textAlign: 'left',
      background: active ? 'var(--cm-sel-bg)' : 'none',
    }}
      onMouseEnter={e => { if (!active) e.currentTarget.style.background = 'var(--cm-hover)' }}
      onMouseLeave={e => { if (!active) e.currentTarget.style.background = active ? 'var(--cm-sel-bg)' : 'none' }}
    >
      <div style={{ width: 5, height: 5, borderRadius: '50%', flexShrink: 0, background: active ? 'var(--cm-link)' : 'var(--cm-text-muted)', opacity: active ? 1 : 0.5 }} />
      <span style={{ fontSize: 11, color: active ? 'var(--cm-link)' : 'var(--cm-text-muted)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</span>
      {active && <Filter size={8} style={{ color: 'var(--cm-link)', flexShrink: 0 }} />}
    </button>
  )
}

// A panel button; with onSplit it gets a second half that opens the same thing beside the map.
function ActionBtn({ icon, label, onClick, title, onSplit }) {
  const base = {
    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4,
    padding: '4px 6px', fontSize: 11, cursor: 'pointer',
    background: 'var(--cm-node-bg)', border: '1px solid var(--cm-border)', color: 'var(--cm-text)',
    transition: 'border-color 0.1s',
  }
  const hover = { onMouseEnter: e => { e.currentTarget.style.borderColor = 'var(--cm-link)' }, onMouseLeave: e => { e.currentTarget.style.borderColor = 'var(--cm-border)' } }
  return (
    <div style={{ display: 'flex', flex: 1, minWidth: 0 }}>
      <button onClick={onClick} title={title} {...hover}
        style={{ ...base, flex: 1, borderRadius: onSplit ? '5px 0 0 5px' : 5 }}>
        {icon} {label}
      </button>
      {onSplit && (
        <button onClick={onSplit} title={`${label} — open beside the map (split)`} {...hover}
          style={{ ...base, padding: '4px 5px', borderLeft: 'none', borderRadius: '0 5px 5px 0', color: 'var(--cm-text-muted)' }}>
          <Columns2 size={11} />
        </button>
      )}
    </div>
  )
}

function StatChip({ label, value }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
      <span style={{ fontSize: 15, fontWeight: 700, color: 'var(--cm-text)', fontVariantNumeric: 'tabular-nums', lineHeight: 1 }}>{value}</span>
      <span style={{ fontSize: 9, color: 'var(--cm-text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em', marginTop: 1 }}>{label}</span>
    </div>
  )
}

export default function DetailPanel({
  cube, cubeData, reverseMap,
  onNavigate, onClose,
  onOpenRules, onOpenView, onOpenRulesSplit, onOpenViewSplit,
  processCallers = {},
  onFilterDim, dimFilter,
  traceKinds, setTraceKinds, transitiveCount, lensUsage = NO_LENS_USAGE,
}) {
  const [followOpen, setFollowOpen] = useState(false)
  if (!cube || !cubeData) return null
  const { dims, hasRules, ruleCalcRefs, ruleFeederRefs, tiWriters = [], tiReaders = [], ruleLoc = 0 } = cubeData
  const incomingCalc = (reverseMap[cube] ?? []).filter(n => n !== cube)

  return (
    <div style={{
      width: 272, borderLeft: '1px solid var(--cm-border)',
      background: 'var(--cm-panel-bg)', display: 'flex', flexDirection: 'column', overflow: 'hidden', flexShrink: 0,
    }}>
      {/* Header */}
      <div style={{ padding: '10px 12px 8px', borderBottom: '1px solid var(--cm-border)', display: 'flex', alignItems: 'center', gap: 6 }}>
        <Layers size={13} style={{ color: hasRules ? '#f59e0b' : 'var(--cm-icon)', flexShrink: 0 }} />
        <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--cm-text)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {cube}
        </span>
        <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 2, color: 'var(--cm-icon)', display: 'flex' }}>
          <X size={13} />
        </button>
      </div>

      {/* Open actions */}
      <div style={{ padding: '8px 10px', borderBottom: '1px solid var(--cm-border)', display: 'flex', gap: 5 }}>
        {hasRules && <ActionBtn icon={<Code2 size={11} />} label="Rules"    onClick={onOpenRules} onSplit={onOpenRulesSplit} title="Open the rules editor" />}
        <ActionBtn icon={<Eye size={11} />}       label="View"     onClick={onOpenView}  onSplit={onOpenViewSplit}  title="Open the cube's Default view — see its data" />
      </div>

      {/* Stats */}
      <div style={{ padding: '8px 12px', borderBottom: '1px solid var(--cm-border)', display: 'flex', gap: 14, justifyContent: 'flex-start' }}>
        <StatChip label="dims"      value={dims.length} />
        {hasRules          && <StatChip label="rule lines" value={ruleLoc} />}
        {transitiveCount > 0 && <StatChip label="connected" value={transitiveCount} />}
        {tiWriters.length > 0 && <StatChip label="TI writers" value={tiWriters.length} />}
        {tiReaders.length > 0 && <StatChip label="TI readers" value={tiReaders.length} />}
      </div>

      {/* Follow kinds */}
      <div style={{ padding: '6px 12px', borderBottom: '1px solid var(--cm-border)' }} title="Fine-tune which kinds of link the trace follows. Show (left panel) switches them in groups.">
        <button onClick={() => setFollowOpen(v => !v)} style={{ display: 'flex', alignItems: 'center', gap: 5, width: '100%', background: 'none', border: 'none', padding: 0, cursor: 'pointer', marginBottom: followOpen ? 5 : 0 }}>
          {followOpen ? <ChevronDown size={10} style={{ color: 'var(--cm-text-muted)' }} /> : <ChevronRight size={10} style={{ color: 'var(--cm-text-muted)' }} />}
          <span style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--cm-text-muted)', opacity: 0.65 }}>Fine-tune the trace</span>
        </button>
        {followOpen && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
          {[
            { k: 'rule',     label: 'Rules' },
            { k: 'feeder',   label: 'Feeders' },
            { k: 'read',     label: 'TI reads' },
            { k: 'write',    label: 'TI writes' },
            { k: 'call',     label: 'Calls' },
            { k: 'dimwrite', label: 'Dim changes' },
            { k: 'dimuse',   label: 'Dim usage' },
          ].map(o => (
            <label key={o.k} style={{ display: 'flex', alignItems: 'center', gap: 3, fontSize: 10, color: 'var(--cm-text-muted)', cursor: 'pointer' }}>
              <input type="checkbox" checked={!!traceKinds[o.k]} onChange={() => setTraceKinds({ ...traceKinds, [o.k]: !traceKinds[o.k] })} />
              {o.label}
            </label>
          ))}
        </div>
        )}
      </div>

      {/* Scrollable sections */}
      <div style={{ overflow: 'auto', flex: 1, paddingTop: 8 }}>

        <Section title="Dimensions" count={dims.length} icon={<Filter size={9} style={{ color: 'var(--cm-text-muted)', opacity: 0.65 }} />}>
          {dims.map(d => (
            <DimItem key={d} name={d} active={dimFilter === d} onClick={() => onFilterDim(d)} />
          ))}
        </Section>

        {ruleCalcRefs.length > 0 && (
          <Section title="Reads from (rules)" count={ruleCalcRefs.length}>
            {ruleCalcRefs.map(ref => <FlowItem key={ref} label={ref} onClick={() => onNavigate(ref)} />)}
          </Section>
        )}

        {incomingCalc.length > 0 && (
          <Section title="Referenced by" count={incomingCalc.length}>
            {incomingCalc.map(ref => (
              <FlowItem key={ref} label={ref} onClick={() => onNavigate(ref)} color="var(--cm-incoming)" />
            ))}
          </Section>
        )}

        {ruleFeederRefs.length > 0 && (
          <Section title="Feeders to" count={ruleFeederRefs.length}>
            {ruleFeederRefs.map(ref => <FlowItem key={ref} label={ref} onClick={() => onNavigate(ref)} />)}
          </Section>
        )}

        {hasRules && !ruleCalcRefs.length && !ruleFeederRefs.length && (
          <div style={{ padding: '2px 12px 10px', fontSize: 11, color: 'var(--cm-text-muted)' }}>
            Has rules — no inter-cube DB() refs found
          </div>
        )}

        {tiWriters.length > 0 && (
          <Section title="Written by (TI)" count={tiWriters.length} icon={<Zap size={9} style={{ color: 'var(--cm-text-muted)', opacity: 0.65 }} />}>
            {tiWriters.map(p => {
              const callers = processCallers[p] ?? []
              return (
                <div key={p}>
                  <FlowItem label={p} onClick={() => onNavigate(`proc:${p}`)} lens={lensUsage[p]}
                    icon={<Workflow size={10} style={{ flexShrink: 0, color: 'var(--cm-link)' }} />}
                  />
                  {callers.length > 0 && (
                    <div style={{ padding: '0 12px 0 30px', fontSize: 9, textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--cm-text-muted)', opacity: 0.5 }}>
                      called by
                    </div>
                  )}
                  {callers.map(c => (
                    <div key={c} style={{ paddingLeft: 18 }}>
                      <FlowItem label={c} onClick={() => onNavigate(`proc:${c}`)} color="var(--cm-text-muted)" lens={lensUsage[c]} />
                    </div>
                  ))}
                </div>
              )
            })}
          </Section>
        )}

        {tiReaders.length > 0 && (
          <Section title="Read by (TI)" count={tiReaders.length} icon={<Zap size={9} style={{ color: 'var(--cm-text-muted)', opacity: 0.65 }} />}>
            {tiReaders.map(p => (
              <FlowItem key={p} label={p} onClick={() => onNavigate(`proc:${p}`)} lens={lensUsage[p]}
                icon={<Workflow size={10} style={{ flexShrink: 0, color: '#0ea5e9' }} />}
              />
            ))}
          </Section>
        )}

      </div>
    </div>
  )
}
