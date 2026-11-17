import { Handle, Position } from '@xyflow/react'
import { Workflow } from 'lucide-react'
import { NODE_W, NODE_H } from '@/lib/cubemap-editor/layout.js'

export default function ProcessNode({ data }) {
  const { label, folded = 0, expanded, onToggleFold, lens } = data
  return (
    <div style={{
      width: NODE_W, height: NODE_H, borderRadius: 8,
      border: '1.5px dashed #10b981', background: 'rgba(16,185,129,0.07)',
      display: 'flex', alignItems: 'center', gap: 8,
      padding: '0 12px', cursor: 'pointer', overflow: 'hidden',
      boxShadow: '0 1px 4px rgba(0,0,0,0.15)',
    }}>
      <Handle type="target" position={Position.Left} style={{ opacity: 0 }} />
      <Workflow size={12} style={{ color: '#10b981', flexShrink: 0 }} />
      <span style={{
        fontSize: 11, fontWeight: 500, color: 'var(--cm-text)', fontFamily: 'monospace',
        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1,
      }}>{label}</span>
      {lens?.length > 0 && (
        <span title={`Run from a Lens button — ${lens.join(', ')}`} style={{
          flexShrink: 0, fontSize: 9, fontWeight: 600, padding: '0 5px', borderRadius: 3,
          border: '1px solid #6366f1', color: '#6366f1', background: 'rgba(99,102,241,0.12)',
        }}>Lens</span>
      )}
      {onToggleFold && (
        <button
          className="nodrag"
          onClick={e => { e.stopPropagation(); onToggleFold() }}
          title={expanded ? 'Fold this chain back into one box' : `${folded} process${folded !== 1 ? 'es' : ''} this one runs — click to show each step`}
          style={{
            flexShrink: 0, fontSize: 10, fontWeight: 600, padding: '1px 6px', borderRadius: 10, cursor: 'pointer',
            border: '1px solid #10b981', background: expanded ? 'none' : 'rgba(16,185,129,0.18)', color: '#10b981',
          }}>{expanded ? '−' : `+${folded}`}</button>
      )}
      <Handle type="source" position={Position.Right} style={{ opacity: 0 }} />
    </div>
  )
}
