import { Handle, Position } from '@xyflow/react'
import { Layers } from 'lucide-react'
import { NODE_W, NODE_H } from '@/lib/cubemap-editor/layout.js'

// A dimension some process changes — pill-shaped so it never reads as a cube
export default function DimNode({ data }) {
  return (
    <div style={{
      width: NODE_W, height: NODE_H - 14, borderRadius: 999,
      border: '1.5px solid #8b5cf6', background: 'rgba(139,92,246,0.07)',
      display: 'flex', alignItems: 'center', gap: 8,
      padding: '0 14px', cursor: 'pointer', overflow: 'hidden',
    }}>
      <Handle type="target" position={Position.Left} style={{ opacity: 0 }} />
      <Layers size={12} style={{ color: '#8b5cf6', flexShrink: 0 }} />
      <span style={{
        fontSize: 11, fontWeight: 500, color: 'var(--cm-text)', fontFamily: 'monospace',
        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1,
      }}>{data.label}</span>
      <Handle type="source" position={Position.Right} style={{ opacity: 0 }} />
    </div>
  )
}
