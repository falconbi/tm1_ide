import { useState } from 'react'
import { toast } from 'sonner'
import { useSaveRules, useCheckRuleReferences, useConflictCheck } from '@/hooks/useApi'

// Save, the concurrent-edit warning and diff, and the non-blocking reference
// integrity check that follows a successful save.
export default function useRulesSave({ tab, editorRef, markTabSaved, bumpRulesVersion }) {
  const saveRules = useSaveRules()
  const checkReferences = useCheckRuleReferences()
  const [dismissedId, setDismissedId] = useState(null)
  const [saveConflict, setSaveConflict] = useState(null)
  const [conflictDiff, setConflictDiff] = useState(null)
  const { openConflict, checkBeforeSave } = useConflictCheck(tab.server, 'rules', tab.cube)

  const doSave = () => {
    const editor = editorRef.current
    if (!editor) return
    const id = toast.loading('Saving rules…')
    saveRules.mutate(
      { server: tab.server, cube: tab.cube, rules: editor.getValue() },
      {
        onSuccess: () => {
          markTabSaved(tab.id)
          bumpRulesVersion(tab.server, tab.cube)
          toast.success('Rules saved', { id })
          // Non-blocking reference integrity check — warnings shown after save
          checkReferences.mutateAsync({ server: tab.server, cube: tab.cube, rules: editor.getValue() })
            .then(d => {
              if (d.warnings?.length) {
                d.warnings.forEach(w => toast.warning(w.message, { duration: 8000 }))
              }
            })
            .catch(() => {})
        },
        onError:   (err) => toast.error(err.message, { id }),
      },
    )
  }

  const handleSave = async () => {
    const conflict = await checkBeforeSave()
    if (conflict) { setSaveConflict(conflict); return }
    doSave()
  }

  return {
    openConflict, dismissedId, setDismissedId,
    saveConflict, setSaveConflict, conflictDiff, setConflictDiff,
    doSave, handleSave, saving: saveRules.isPending,
  }
}
