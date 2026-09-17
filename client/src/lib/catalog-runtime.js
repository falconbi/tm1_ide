// Runtime merge of user-editable Catalog Admin overrides into the base catalogs.
//
// The base catalogs (RULES_CATALOG / TI_CATALOG in tm1-completion.js) drive
// autocomplete, hover and validation directly. User edits made in the Catalog
// Admin panel persist to config/function-catalog-overrides.json on the server.
// This module merges those overrides into the effective catalogs used by the
// editor so the admin panel changes actually reach autocomplete + validation.
//
// Usage: call initEffectiveCatalogs({ rules, ti }) once at app start, then read
// via getRulesCatalog() / getTICatalog(). Until initialised (or if the fetch
// fails), getters return null and callers fall back to the base catalogs.

let state = { rules: null, ti: null }

function mergeCatalog(base, overrides = {}) {
  const { overrides: ov = {}, additions = {}, deletions = [] } = overrides
  const deleted = new Set(deletions)
  const out = { ...base }
  for (const name of deleted) delete out[name]
  for (const [name, patch] of Object.entries(ov)) {
    if (deleted.has(name)) continue
    if (out[name]) out[name] = { ...out[name], ...patch }
  }
  for (const [name, entry] of Object.entries(additions)) {
    if (deleted.has(name)) continue
    out[name] = entry
  }
  return out
}

export async function initEffectiveCatalogs(base) {
  try {
    const r = await fetch('/api/admin/catalog-overrides')
    if (!r.ok) return state
    const o = await r.json()
    state.rules = mergeCatalog(base.rules, o.rules)
    state.ti    = mergeCatalog(base.ti, o.ti)
  } catch {
    // offline / not an admin — fall back to base catalogs
  }
  return state
}

export const getRulesCatalog = () => state.rules
export const getTICatalog    = () => state.ti

// Resolve one entry in the effective catalog.
//   lang:   'rules' | 'ti'
//   name:   function name (any case)
//   base:   the base catalog object (used to distinguish "deleted" from "absent")
// Returns the entry, or null if absent/deleted.
export function catalogEntry(lang, name, base) {
  const upper = String(name).toUpperCase()
  const eff = lang === 'rules' ? state.rules : state.ti
  if (!eff) return base[upper] ?? null
  if (eff[upper]) return eff[upper]
  if (upper in base) return null // present in base but deleted via overrides
  return null
}