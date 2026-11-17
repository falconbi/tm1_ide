import { useState } from 'react'

const BIG_VIEW_ROWS = 5000

// The executed cellset, the truncation flag, and the guard that stops a huge
// result from freezing the grid until the user asks for it.
export default function useViewResultState() {
    const [result, setResult] = useState(null)
    const [truncated, setTruncated] = useState(false)

    // A view with tens of thousands of rows (e.g. a TI source view) froze the browser while the grid was
    // built; past BIG_VIEW_ROWS the grid waits until the user asks for it.
    const resultRows  = result?.Axes?.find?.(a => a.Ordinal === 1)?.Tuples?.length ?? result?.Axes?.[1]?.Tuples?.length ?? 0
    const [bigConfirmed, setBigConfirmed] = useState(null)
    const tooBig      = resultRows > BIG_VIEW_ROWS && bigConfirmed !== result
    const gridResult  = tooBig ? null : result

    return { result, setResult, truncated, setTruncated, bigConfirmed, setBigConfirmed, resultRows, tooBig, gridResult }
}
