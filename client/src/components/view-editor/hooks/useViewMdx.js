import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { useConfig, useGenerateViewMDX } from '@/hooks/useApi'
import { loadViewSessions, saveViewSessionEntry } from '@/lib/view-editor/view-sessions.js'

// MDX text, visual/MDX mode, saved local sessions, and the AI generate prompt —
// everything that belongs to the editor's text side rather than the builder.
export default function useViewMdx({ tab, patchTab, setAxes, axes }) {
    // MDX editor state — use savedMdx to survive remounts
    const [mdx, setMdx] = useState(tab.savedMdx ?? tab.initialMdx ?? '')
    const mdxRef = useRef(mdx); mdxRef.current = mdx
    useEffect(() => () => patchTab(tab.id, { savedMdx: mdxRef.current }), [])
    const [mdxDirty, setMdxDirty] = useState(false)

    // View mode: 'visual' | 'mdx'
    const [mode, setMode] = useState(tab.mode ?? (tab.initialMdx ? 'mdx' : 'visual'))
    useEffect(() => { patchTab(tab.id, { mode }) }, [mode])

    // AI generate — front door for building a view from a description
    const { data: config } = useConfig()
    const hasAI = !!config?.hasAI
    const [aiPrompt, setAiPrompt] = useState('')
    const generateViewMDX = useGenerateViewMDX()
    const handleGenerateAI = useCallback(() => {
        if (!aiPrompt.trim() || generateViewMDX.isPending) return
        generateViewMDX.mutate({ server: tab.server, cube: tab.cube, prompt: aiPrompt }, {
            onSuccess: d => {
                setMdx(d.mdx)
                setMode('mdx')
                setMdxDirty(true)
                toast.success('MDX generated — review, then Save')
            },
            onError: e => toast.error(e.message),
        })
    }, [aiPrompt, generateViewMDX, tab.server, tab.cube])

    // Saved sessions — named local drafts, for experimenting before settling
    // on the final view.
    const [sessionsOpen, setSessionsOpen]     = useState(false)
    const [sessionName, setSessionName]       = useState('')
    const [sessions, setSessions]             = useState(loadViewSessions)
    const [sessionSavedIndicator, setSessionSavedIndicator] = useState(false)

    const handleSaveSession = useCallback(() => {
        if (!sessionName.trim()) return
        saveViewSessionEntry({ name: sessionName.trim(), cube: tab.cube, mode, mdx, axes })
        setSessions(loadViewSessions())
        setSessionSavedIndicator(true)
        setTimeout(() => setSessionSavedIndicator(false), 2000)
        setSessionName('')
    }, [sessionName, tab.cube, mode, mdx, axes])
    const handleLoadSession = useCallback((s) => {
        if (s.axes) setAxes(s.axes)
        if (s.mdx != null) setMdx(s.mdx)
        setMode(s.mode ?? 'visual')
        setSessionsOpen(false)
        toast.success(`Loaded "${s.name}"`)
    }, [setAxes])

    const [mdxEditorHeight, setMdxEditorHeight] = useState(224)
    const startMdxEditorResize = useCallback((e) => {
        e.preventDefault()
        const startY = e.clientY
        const startH = mdxEditorHeight
        const onMove = (mv) => setMdxEditorHeight(Math.max(80, Math.min(startH + (mv.clientY - startY), 600)))
        const onUp = () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp) }
        window.addEventListener('mousemove', onMove)
        window.addEventListener('mouseup', onUp)
    }, [mdxEditorHeight])
    const editorRef = useRef(null)

    return {
        mdx, setMdx, mdxDirty, setMdxDirty,
        mode, setMode,
        hasAI, aiPrompt, setAiPrompt, handleGenerateAI, generateViewMDX,
        sessionsOpen, setSessionsOpen, sessionName, setSessionName,
        sessions, sessionSavedIndicator, handleSaveSession, handleLoadSession,
        mdxEditorHeight, startMdxEditorResize, editorRef,
    }
}
