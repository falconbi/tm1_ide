import { useEffect, useState } from 'react'
import { useTraceCellCalc } from '@/hooks/useApi'

function useTraceData(server, cube, dimElemPairs, nonce = 0) {
    const [data,  setData]  = useState(null)
    const [error, setError] = useState(null)
    const [busy,  setBusy]  = useState(true)
    const traceCell = useTraceCellCalc()
    const key = JSON.stringify({ server, cube, dimElemPairs, nonce })

    useEffect(() => {
        let live = true
        setBusy(true); setError(null); setData(null)
        traceCell.mutateAsync({ server, cube, dimElemPairs })
            .then(d => { if (!live) return; setBusy(false); d?.error ? setError(d.error) : setData(d) })
            .catch(e => { if (live) { setBusy(false); setError(e.message) } })
        return () => { live = false }
    }, [key])  // eslint-disable-line react-hooks/exhaustive-deps

    return { data, error, busy }
}

export default useTraceData
