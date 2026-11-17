export default function GroupNode({ data }) {
  return (
    <div style={{
      width: '100%', height: '100%', borderRadius: 10,
      border: `1.5px solid ${data.color}55`,
      background: data.bg,
      pointerEvents: 'auto',
      cursor: 'pointer',
      transition: 'border-color 0.15s',
    }} title={`Focus module ${data.label}`}>
      <div style={{
        position: 'absolute', top: 6, left: 10,
        fontSize: 9, fontWeight: 800, letterSpacing: '0.08em', textTransform: 'uppercase',
        color: data.color, display: 'flex', alignItems: 'center', gap: 5, pointerEvents: 'none',
      }}>
        {data.label}
        <span style={{ fontWeight: 400, opacity: 0.55, fontVariantNumeric: 'tabular-nums' }}>{data.count}</span>
      </div>
    </div>
  )
}
