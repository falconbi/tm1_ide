import { Handle, Position } from '@xyflow/react'
import { Layers } from 'lucide-react'
import { NODE_W, NODE_H } from '@/lib/cubemap-editor/layout.js'

export default function CubeNode({ data, selected }) {
  const { label, hasRules, ruleLoc = 0, dimCount = 0, isSpotlit } = data
  const barH = hasRules ? Math.max(4, Math.min(16, 4 + Math.round(Math.log1p(ruleLoc) * 2.5))) : 0

  return (
    <div style={{
      width: NODE_W, height: NODE_H, borderRadius: 8, position: 'relative',
      border: isSpotlit ? '2px solid #60a5fa'
            : selected  ? '2px solid #60a5fa'
            : '1.5px solid var(--cm-border)',
      background: selected ? 'var(--cm-sel-bg)'
                : 'var(--cm-node-bg)',
      display: 'flex', alignItems: 'center', gap: 8,
      padding: '0 12px', cursor: 'pointer', overflow: 'hidden',
      boxShadow: isSpotlit ? '0 0 0 3px rgba(96,165,250,0.28), 0 2px 10px rgba(96,165,250,0.15)'
               : selected  ? '0 0 0 3px rgba(96,165,250,0.18)'
               : '0 1px 4px rgba(0,0,0,0.2)',
      transition: 'border-color 0.15s, background 0.15s, box-shadow 0.15s',
    }}>
      {barH > 0 && (
        <div style={{
          position: 'absolute', left: 0, top: '50%', transform: 'translateY(-50%)',
          width: 3, height: `${barH}px`,
          background: '#f59e0b',
          borderRadius: '4px 0 0 4px',
        }} />
      )}
      <Handle type="target" position={Position.Left} style={{ opacity: 0 }} />
      <Layers size={13} style={{ color: hasRules ? '#f59e0b' : 'var(--cm-icon)', flexShrink: 0 }} />
      <span style={{
        fontSize: 12, fontWeight: 500, color: 'var(--cm-text)',
        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1,
      }}>{label}</span>
      {dimCount > 0 && (
        <span style={{ fontSize: 9, color: 'var(--cm-text-muted)', flexShrink: 0, fontVariantNumeric: 'tabular-nums', opacity: 0.7 }}>
          {dimCount}d
        </span>
      )}
      <Handle type="source" position={Position.Right} style={{ opacity: 0 }} />
    </div>
  )
}
