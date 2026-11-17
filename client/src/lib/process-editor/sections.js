import { CODE_TABS } from './constants.js'

// The four section bodies a save/check/debug request sends: an edit wins, then
// the saved process body, then an empty string for a section with neither.
export function sectionsFromEdits(edits = {}, data = null) {
  const sections = {}
  for (const { key } of CODE_TABS) sections[key] = edits[key] ?? data?.[key] ?? ''
  return sections
}

// A run's parameter array: a value typed in the dialog wins, otherwise the
// parameter's default from the process definition.
export function runParamArray(defaultParams = [], values = {}) {
  return (defaultParams ?? []).map(p => {
    const raw = values?.[p.Name]
    return { Name: p.Name, Value: raw !== undefined ? raw : (p.Value ?? '') }
  })
}
