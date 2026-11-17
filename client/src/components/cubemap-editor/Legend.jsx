import { X } from 'lucide-react'

export default function Legend({ onClose }) {
  return (
    <div style={{
      position: 'absolute', bottom: 44, right: 10, zIndex: 5,
      background: 'var(--cm-panel-bg)', border: '1px solid var(--cm-border)',
      borderRadius: 7, padding: '8px 12px', fontSize: 10, color: 'var(--cm-text-muted)',
      display: 'flex', flexDirection: 'column', gap: 6,
      boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 2 }}>
        <span style={{ fontWeight: 700, fontSize: 9, textTransform: 'uppercase', letterSpacing: '0.06em', flex: 1 }}>Legend</span>
        <button onClick={onClose} title="Hide the legend (the book icon at the top brings it back)" style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, color: 'var(--cm-icon)', display: 'flex', alignItems: 'center' }}>
          <X size={10} />
        </button>
      </div>
      {[
        { el: <div style={{ width: 20, height: 1.5, background: '#b45309' }} />,                      label: 'Rule DB() reference'     },
        { el: <div style={{ width: 20, borderTop: '1.5px dashed #475569' }} />,                       label: 'Feeder reference'        },
        { el: <div style={{ width: 3, height: 10, background: '#f59e0b', borderRadius: 2 }} />,       label: 'Has rules (bar = lines of rules)'   },
        { el: <div style={{ width: 6, height: 6, borderRadius: '50%', background: '#60a5fa' }} />,     label: 'Dim spotlight match'   },
        { el: <div style={{ width: 20, height: 1.5, background: '#10b981' }} />,                       label: 'TI writes to cube'       },
        { el: <div style={{ width: 20, borderTop: '1.5px dashed #0ea5e9' }} />,                        label: 'Cube read by TI'         },
        { el: <div style={{ width: 20, height: 1.5, background: '#8b5cf6' }} />,                       label: 'TI changes dimension'    },
        { el: <div style={{ width: 20, borderTop: '1.5px dotted #8b5cf6' }} />,                        label: 'Dimension used by cube (focus)' },
        { el: <div style={{ width: 20, borderTop: '1.5px dashed #10b981' }} />,                        label: 'Process calls process'  },
      ].map(({ el, label }) => (
        <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ width: 22, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>{el}</div>
          <span>{label}</span>
        </div>
      ))}
    </div>
  )
}
