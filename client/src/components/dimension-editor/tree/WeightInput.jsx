// ── Weight input ────────────────────────────────────────────────────────────
export default function WeightInput({ value, onSave }) {
  return (
    <input
      type="number"
      defaultValue={value}
      onBlur={e => { const n = parseFloat(e.target.value); if (!isNaN(n) && n !== value) onSave(n) }}
      onKeyDown={e => { if (e.key === 'Enter') e.target.blur() }}
      step="any"
      className="w-14 text-[10px] font-mono bg-muted border border-border rounded px-1 py-px text-right outline-none focus:border-primary"
    />
  )
}
