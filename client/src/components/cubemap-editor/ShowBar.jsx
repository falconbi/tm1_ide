import {
  Clapperboard, SkipBack, StepBack, Play, Pause, StepForward, Info, X,
  Code2, ExternalLink,
} from 'lucide-react'

export default function ShowBar({ entries, entry, onEntry, seq, idx, step, playing, onPlay, onPrev, onNext, onRestart, speed, onSpeed, follow, onFollow, onClose, processInfo = {}, cubeData = {}, dimData = {}, onOpenProcess, onOpenRules, onOpenCube, onOpenDimension, onPause, showInfo, onToggleInfo, onBeforeNavigate }) {
  const btn = { background: 'none', border: '1px solid var(--cm-border)', borderRadius: 4, cursor: 'pointer', padding: '3px 6px', color: 'var(--cm-text)', display: 'flex', alignItems: 'center' }
  return (
    <div style={{
      position: 'absolute', bottom: 12, left: '50%', transform: 'translateX(-50%)', zIndex: 6,
      width: 'min(680px, calc(100% - 24px))', boxSizing: 'border-box',
      background: 'var(--cm-panel-bg)', border: '1px solid var(--cm-border)', borderRadius: 8,
      boxShadow: '0 4px 16px rgba(0,0,0,0.25)', padding: '8px 10px', fontSize: 11, color: 'var(--cm-text)',
      display: 'flex', flexDirection: 'column', gap: 6,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
        <Clapperboard size={13} style={{ color: '#f59e0b', flexShrink: 0 }} />
        <select value={entry} onChange={e => onEntry(e.target.value)} title="Where the run starts" style={{
          flex: 1, minWidth: 140, fontSize: 11, padding: '3px 4px', background: 'var(--cm-node-bg)',
          color: 'var(--cm-text)', border: '1px solid var(--cm-border)', borderRadius: 4,
        }}>
          <option value="" disabled>Start from…</option>
          {entries.map(e => <option key={e.key} value={e.key}>{e.label}</option>)}
        </select>
        <button style={btn} onClick={onRestart} disabled={!seq} title="Back to the start"><SkipBack size={12} /></button>
        <button style={btn} onClick={onPrev}    disabled={!seq} title="Previous step"><StepBack size={12} /></button>
        <button style={{ ...btn, borderColor: '#f59e0b', color: '#f59e0b' }} onClick={onPlay} disabled={!entries.length} title={playing ? 'Pause' : 'Play'}>
          {playing ? <Pause size={12} /> : <Play size={12} />}
        </button>
        <button style={btn} onClick={onNext}    disabled={!seq} title="Next step"><StepForward size={12} /></button>
        <select value={speed} onChange={e => onSpeed(Number(e.target.value))} title="Speed" style={{ fontSize: 11, padding: '2px', background: 'var(--cm-node-bg)', color: 'var(--cm-text)', border: '1px solid var(--cm-border)', borderRadius: 4 }}>
          {[0.5, 1, 2, 4].map(s => <option key={s} value={s}>{s}×</option>)}
        </select>
        <label style={{ display: 'flex', alignItems: 'center', gap: 3, color: 'var(--cm-text-muted)', cursor: 'pointer' }} title="Pan (never zoom) to a step when it's off-screen">
          <input type="checkbox" checked={follow} onChange={e => onFollow(e.target.checked)} /> Follow
        </label>
        <button style={{ ...btn, borderColor: showInfo ? '#0ea5e9' : 'var(--cm-border)', color: showInfo ? '#0ea5e9' : 'var(--cm-text)' }}
          onClick={onToggleInfo} disabled={!step} title="What is this step?">
          <Info size={12} />
        </button>
        <button style={{ ...btn, border: 'none' }} onClick={onClose} title="Close Show"><X size={12} /></button>
      </div>
      {!entries.length && <div style={{ color: 'var(--cm-text-muted)' }}>No entry points — no process here reads, writes or calls anything.</div>}
      {step && (
        <>
          <div style={{ fontSize: 10, color: 'var(--cm-text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {step.path.join('  ›  ')}
          </div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
            <span style={{ fontVariantNumeric: 'tabular-nums', color: 'var(--cm-text-muted)', flexShrink: 0 }}>{idx + 1} / {seq.length}</span>
            <span style={{ fontWeight: 600, fontFamily: 'monospace' }}>{step.caption}</span>
          </div>
          {showInfo && <StepInfo step={step} idx={idx} total={seq.length} processInfo={processInfo} cubeData={cubeData} dimData={dimData}
            onOpenProcess={onOpenProcess} onOpenRules={onOpenRules} onOpenCube={onOpenCube} onOpenDimension={onOpenDimension} onPause={onPause}
            onBeforeNavigate={onBeforeNavigate} onClose={onToggleInfo} />}
          {idx === seq.length - 1 && (
            <div style={{ fontSize: 10, color: 'var(--cm-text-muted)', opacity: 0.75 }}>
              End of run. Order follows the code as written — loops play once; it's not a replay of a real run.
            </div>
          )}
        </>
      )}
    </div>
  )
}

// ── Step details (Show info) ─────────────────────────────────────────────────
function StepInfo({ step, idx, total, processInfo, cubeData, dimData, onOpenProcess, onOpenRules, onOpenCube, onOpenDimension, onPause, onBeforeNavigate, onClose }) {
  const procName = step?.path?.[step.path.length - 1]
  const proc = procName && !String(procName).startsWith('⏱') ? procName : null
  const info = proc ? processInfo[proc] : null
  const cube = step?.nodes?.find(n => !n.startsWith('proc:') && !n.startsWith('dim:') && cubeData[n]) ?? null
  const dim = step?.nodes?.find(n => n.startsWith('dim:'))?.slice(4) ?? null
  const cd = cube ? cubeData[cube] : null
  const dd = dim ? dimData[dim] : null
  const open = fn => { onPause?.(); onBeforeNavigate?.(); fn?.() }

  const label = { fontSize: 9, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--cm-text-muted)', opacity: 0.7, marginBottom: 2 }
  const link = { display: 'inline-flex', alignItems: 'center', gap: 3, padding: '2px 6px', fontSize: 10, borderRadius: 4, border: '1px solid var(--cm-border)', background: 'var(--cm-node-bg)', color: 'var(--cm-text)', cursor: 'pointer' }
  const mono = { fontFamily: 'monospace', color: 'var(--cm-link)' }
  const chip = { padding: '1px 5px', borderRadius: 3, border: '1px solid var(--cm-border)', fontSize: 9, color: 'var(--cm-text)' }

  return (
    <div style={{ background: 'var(--cm-toolbar)', border: '1px solid var(--cm-border)', borderRadius: 6, padding: '7px 9px', maxHeight: 260, overflow: 'auto', display: 'flex', flexDirection: 'column', gap: 7 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 10, color: 'var(--cm-text-muted)' }}>
        <Info size={11} style={{ color: '#0ea5e9' }} />
        <span>Step {idx + 1} of {total}</span>
        <button onClick={onClose} style={{ marginLeft: 'auto', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--cm-text-muted)', display: 'flex' }}><X size={10} /></button>
      </div>

      {proc && (
        <div>
          <div style={label}>Process</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
            <span style={{ ...mono, fontSize: 11 }}>{proc}</span>
            <button style={link} onClick={ev => open(() => onOpenProcess(proc, ev.altKey))}><ExternalLink size={9} /> Open process</button>
          </div>
          {info?.summary ? (
            <div style={{ marginTop: 3 }}>
              <div style={{ ...label, marginBottom: 0 }}>{info.sourceKind === 'manual' ? 'Summary' : 'AI summary'}{info.at ? ' · ' + String(info.at).slice(0, 10) : ''}</div>
              <div style={{ color: 'var(--cm-text)', lineHeight: 1.5 }}>{info.summary}</div>
            </div>
          ) : info?.header ? (
            <div style={{ marginTop: 3, color: 'var(--cm-text-muted)', lineHeight: 1.5 }}>{info.header}</div>
          ) : null}
          {info?.parameters?.length > 0 && (
            <div style={{ marginTop: 3, display: 'flex', gap: 4, flexWrap: 'wrap' }}>
              <span style={{ ...label, marginBottom: 0 }}>Parameters</span>
              {info.parameters.map(p => <span key={p} style={chip}>{p}</span>)}
            </div>
          )}
        </div>
      )}

      {cube && (
        <div>
          <div style={label}>Cube {step.kind === 'read' ? 'read' : step.kind === 'write' ? 'written' : ''}</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
            <span style={{ ...mono, fontSize: 11 }}>{cube}</span>
            {cd?.hasRules && <button style={link} onClick={ev => open(() => onOpenRules(cube, ev.altKey))}><Code2 size={9} /> Open rules</button>}
            <button style={link} onClick={ev => open(() => onOpenCube(cube, ev.altKey))}><ExternalLink size={9} /> Open view</button>
          </div>
          {step.measures?.length > 0 && (
            <div style={{ marginTop: 3, display: 'flex', gap: 4, flexWrap: 'wrap' }}>
              <span style={{ ...label, marginBottom: 0 }}>Writes</span>
              {step.measures.map(m => <span key={m} style={chip}>{m}</span>)}
            </div>
          )}
          <div style={{ marginTop: 3, display: 'flex', gap: 8, flexWrap: 'wrap', fontSize: 10, color: 'var(--cm-text-muted)' }}>
            <span>{cd?.dims?.length ?? 0} dimensions</span>
            <span>{cd?.hasRules ? `${cd.ruleLoc ?? 0} rule lines` : 'no rules'}</span>
            {cd?.dims?.length > 0 && <span title={cd.dims.join(', ')}>{cd.dims.slice(0, 5).join(', ')}{cd.dims.length > 5 ? '…' : ''}</span>}
          </div>
        </div>
      )}

      {dim && (
        <div>
          <div style={label}>Dimension</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
            <span style={{ ...mono, fontSize: 11 }}>{dim}</span>
            <button style={link} onClick={ev => open(() => onOpenDimension(dim, ev.altKey))}><ExternalLink size={9} /> Open dimension</button>
          </div>
          <div style={{ marginTop: 3, fontSize: 10, color: 'var(--cm-text-muted)' }}>
            {dd?.cubes?.length ?? 0} cubes use it · {dd?.writers?.length ?? 0} TIs change it
          </div>
        </div>
      )}

      {!proc && !cube && !dim && (
        <div style={{ color: 'var(--cm-text-muted)' }}>{step?.caption}</div>
      )}
    </div>
  )
}
