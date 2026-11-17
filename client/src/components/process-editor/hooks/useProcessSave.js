import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { useStore } from '@/store'
import { useSaveProcess, useCreateProcess, useCheckReferences, useConflictCheck } from '@/hooks/useApi'
import { processTabId } from '@/lib/tab-ids'
import { sectionsFromEdits } from '@/lib/process-editor/sections'
import { toTypeStr } from '@/lib/process-editor/constants'

// Save, Save As, create a new process, the conflict banner/diff and the
// non-blocking reference check that follows a successful save.
export default function useProcessSave({ tab, data, edits, paramEdits, dsEdits }) {
  const { markTabSaved, openTab, patchTab } = useStore()
  const saveProcess   = useSaveProcess()
  const createProcess = useCreateProcess()
  const checkReferences = useCheckReferences()
  const { openConflict, checkBeforeSave } = useConflictCheck(tab.server, 'process', tab.name)

  const [showSaveAs, setShowSaveAs] = useState(false)
  const [showSaveMenu, setShowSaveMenu] = useState(false)
  const [saveMenuRect, setSaveMenuRect] = useState(null)   // fixed position: the toolbar row clips anything hanging below it
  const [draftName, setDraftName] = useState('')
  const [dismissedId, setDismissedId] = useState(null)
  const [saveConflict, setSaveConflict] = useState(null)
  const [conflictDiff, setConflictDiff] = useState(null)

  const handleCreateNew = () => {
    const name = draftName.trim()
    if (!name) return
    const body = sectionsFromEdits(edits)
    if (paramEdits !== null) body.Parameters = paramEdits.map(p => ({ Name: p.Name, Type: toTypeStr(p.Type), Value: String(p.Value ?? ''), Prompt: p.Prompt ?? '' }))
    if (dsEdits !== null) body.DataSource = dsEdits
    const id = toast.loading(`Creating "${name}"…`)
    createProcess.mutate({ server: tab.server, name }, {
      onSuccess: () => saveProcess.mutate({ server: tab.server, name, body }, {
        onSuccess: () => { toast.success(`Process created`, { id }); patchTab(tab.id, { name, label: name }) },
        onError: e => toast.error(e.message, { id }),
      }),
      onError: e => toast.error(e.message, { id }),
    })
  }

  const doSave = () => {
    if (!data) return
    const body = sectionsFromEdits(edits, data)
    if (paramEdits !== null) {
      body.Parameters = paramEdits.map(p => ({
        Name:   p.Name,
        Type:   toTypeStr(p.Type),
        Value:  String(p.Value ?? ''),
        Prompt: p.Prompt ?? '',
      }))
    }
    if (dsEdits !== null) {
      body.DataSource = dsEdits
    }
    const id = toast.loading('Saving process…')
    saveProcess.mutate(
      { server: tab.server, name: tab.name, body },
      {
        onSuccess: () => {
          markTabSaved(tab.id)
          toast.success('Process saved', { id })
          // Non-blocking reference integrity check
          const sections = sectionsFromEdits(edits, data)
          checkReferences.mutate(
            { server: tab.server, sections },
            {
              onSuccess: d => { d.warnings?.forEach(w => toast.warning(w.message, { duration: 8000 })) },
              onError: () => {},
            },
          )
        },
        onError:   (e) => toast.error(e.message, { id }),
      },
    )
  }

  const handleSave = async () => {
    if (!tab.name) { handleCreateNew(); return }
    const conflict = await checkBeforeSave()
    if (conflict) { setSaveConflict(conflict); return }
    doSave()
  }

  const handleSaveAs = (newName) => {
    const body = sectionsFromEdits(edits, data)
    if (paramEdits !== null) body.Parameters = paramEdits.map(p => ({ Name: p.Name, Type: toTypeStr(p.Type), Value: String(p.Value ?? ''), Prompt: p.Prompt ?? '' }))
    if (dsEdits !== null) body.DataSource = dsEdits
    const id = toast.loading(`Creating "${newName}"…`)
    createProcess.mutate({ server: tab.server, name: newName }, {
      onSuccess: () => saveProcess.mutate({ server: tab.server, name: newName, body }, {
        onSuccess: () => {
          toast.success(`Saved as "${newName}"`, { id })
          setShowSaveAs(false)
          openTab({ id: processTabId(tab.server, newName), type: 'process', label: newName, server: tab.server, name: newName, content: null })
        },
        onError: e => toast.error(e.message, { id }),
      }),
      onError: e => toast.error(e.message, { id }),
    })
  }

  useEffect(() => {
    const handler = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault()
        handleSave()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [data, edits])

  const bannerConflict = openConflict?.id !== dismissedId ? openConflict : null
  const dismissBanner = () => setDismissedId(openConflict?.id)
  const saveAnyway = () => { setSaveConflict(null); doSave() }
  const cancelSaveConflict = () => setSaveConflict(null)
  const showConflictDiff = () => {
    const current = {
      prolog:   edits.PrologProcedure   ?? data?.PrologProcedure   ?? '',
      metadata: edits.MetadataProcedure ?? data?.MetadataProcedure ?? '',
      data:     edits.DataProcedure     ?? data?.DataProcedure     ?? '',
      epilog:   edits.EpilogProcedure   ?? data?.EpilogProcedure   ?? '',
    }
    setConflictDiff({
      object_type: 'process',
      object_name: tab.name,
      timestamp:   saveConflict.timestamp,
      action:      'CONFLICT',
      session_name: null,
      before_state: saveConflict.after_state ?? current,
      after_state:  current,
    })
  }
  const toggleSaveMenu = (rect) => { setSaveMenuRect(rect); setShowSaveMenu(v => !v) }
  const closeSaveMenu = () => setShowSaveMenu(false)
  const openSaveAs = () => { setShowSaveAs(true); setShowSaveMenu(false) }

  return {
    bannerConflict, dismissBanner,
    saveConflict, saveAnyway, cancelSaveConflict, showConflictDiff,
    conflictDiff, closeConflictDiff: () => setConflictDiff(null),
    showSaveAs, setShowSaveAs, draftName, setDraftName,
    showSaveMenu, saveMenuRect, toggleSaveMenu, closeSaveMenu, openSaveAs,
    handleCreateNew, handleSave, handleSaveAs,
    createPending: createProcess.isPending, saving: saveProcess.isPending,
  }
}
