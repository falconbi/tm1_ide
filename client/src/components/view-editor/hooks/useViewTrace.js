import { useEffect, useRef, useState } from 'react'

// The open trace (and its drill stack) survive a tab switch — saved onto the
// tab when the editor unmounts.
export default function useViewTrace({ tab, patchTab }) {
    const [traceCtx, setTraceCtx] = useState(() => tab.savedTrace?.ctx ?? null)
    const traceRef = useRef(tab.savedTrace ?? null)
    useEffect(() => { traceRef.current = traceCtx ? { ctx: traceCtx, stack: traceRef.current?.ctx === traceCtx ? traceRef.current.stack : null } : null }, [traceCtx])
    useEffect(() => () => patchTab(tab.id, { savedTrace: traceRef.current }), [])  // eslint-disable-line

    return { traceCtx, setTraceCtx, traceRef }
}
