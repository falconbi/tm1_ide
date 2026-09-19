import { clsx } from "clsx";
import { twMerge } from "tailwind-merge"

export function cn(...inputs) {
  return twMerge(clsx(inputs));
}

// Numeric comparator for AG Grid column sorting.
// TM1 FormattedValues may contain commas, brackets, % signs, currency symbols etc.
// Strip non-numeric decoration and compare as numbers so "1,000" sorts after "999".
export function tm1NumericComparator(v1, v2) {
  const toNum = (s) => {
    if (typeof s === 'number') return Number.isFinite(s) ? s : NaN
    const cleaned = String(s ?? '').replace(/[^\d.-]/g, '')
    const n = cleaned === '' || cleaned === '-' ? NaN : Number(cleaned)
    return Number.isFinite(n) ? n : NaN
  }
  const a = toNum(v1)
  const b = toNum(v2)
  if (Number.isNaN(a)) return Number.isNaN(b) ? 0 : 1
  if (Number.isNaN(b)) return -1
  return a - b
}
