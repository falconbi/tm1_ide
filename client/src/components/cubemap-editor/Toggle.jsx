export default function Toggle({ active, onClick, color, label, dashed, title, disabled }) {
  return (
    <button onClick={disabled ? undefined : onClick} title={title} aria-disabled={disabled || undefined} style={{
      flex: 1, display: 'flex', alignItems: 'center', gap: 4,
      padding: '3px 6px', fontSize: 10, borderRadius: 4, cursor: disabled ? 'not-allowed' : 'pointer',
      opacity: disabled ? 0.45 : 1,
      border: `1px solid ${active ? color : 'var(--cm-border)'}`,
      background: active ? `${color}22` : 'none',
      color: active ? color : 'var(--cm-text-muted)',
      transition: 'all 0.1s',
    }}>
      <div style={{
        width: 16, flexShrink: 0,
        height: dashed ? 0 : 2,
        borderTop: dashed ? `2px dashed ${active ? color : 'var(--cm-text-muted)'}` : 'none',
        background: dashed ? 'none' : (active ? color : 'var(--cm-text-muted)'),
        borderRadius: dashed ? 0 : 1,
      }} />
      {label}
    </button>
  )
}
