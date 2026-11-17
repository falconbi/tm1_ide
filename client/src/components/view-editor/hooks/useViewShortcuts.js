import { useEffect } from 'react'

// Keyboard shortcuts (work globally in both visual + MDX modes).
export default function useViewShortcuts({ handleExecute, handleSave, handleSaveAs, viewName }) {
    useEffect(() => {
        const onKey = (e) => {
            const ctrl = e.ctrlKey || e.metaKey
            if (!ctrl) return
            if (e.key === 'Enter') {
                e.preventDefault()
                handleExecute()
            }
            if (e.key.toLowerCase() === 's') {
                if (e.shiftKey) {
                    e.preventDefault()
                    handleSaveAs()
                } else if (viewName) {
                    e.preventDefault()
                    handleSave()
                }
            }
        }
        window.addEventListener('keydown', onKey)
        return () => window.removeEventListener('keydown', onKey)
    }, [handleExecute, handleSave, handleSaveAs, viewName])
}
