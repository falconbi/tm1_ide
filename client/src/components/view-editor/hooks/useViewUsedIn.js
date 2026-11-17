import { useCallback, useState } from 'react'
import { usePawBookUsage, useViewUsage } from '@/hooks/useApi'

// The "Used In" panel: which TI processes and PAW books reference this view.
export default function useViewUsedIn({ tab }) {
    const [showUsedIn, setShowUsedIn] = useState(false)
    const { data: pawBookData, isFetching: loadingPawBooks, refetch: refetchPawBooks } = usePawBookUsage(tab.server, tab.cube, tab.viewName)
    const { data: usageData,   isFetching: loadingUsage,   refetch: refetchUsage }    = useViewUsage(tab.server, tab.cube, tab.viewName)
    const refetchUsedIn = useCallback(() => { refetchUsage(); refetchPawBooks() }, [refetchUsage, refetchPawBooks])
    const loadingUsedIn = loadingUsage || loadingPawBooks
    return { showUsedIn, setShowUsedIn, pawBookData, usageData, refetchUsedIn, loadingUsedIn }
}
