'use strict'

// ── Who changed it: the three-way origin ────────────────────────────────────
// Refresh used to compare PROD with DEV and call every difference "a change PROD
// made". That cannot distinguish an addition on PROD from a deliberate deletion
// on DEV, and on the WFP cut it offered to put back 2,295 employees and 2,503
// positions the cut had just removed.
//
// With the baseline (the release the target last received) there are three
// copies, and every difference has one honest name:
//
//   base  prod  dev   origin
//   ---   ----  ---   ------------------------------------------------
//   -     yes   -     target-added     bring across (ticked)
//   -     yes   yes   both             nothing to do (they agree)
//   -     yes   no    conflict         both added it, differently
//   -     -     yes   dev-added        not a refresh question
//   yes   -     -     both-removed     nothing to do
//   yes   -     yes   target-removed   offer "delete on DEV too?" (unticked)
//   yes   yes   -     dev-removed      NOT offered — DEV removed it
//   yes   yes   yes   (values decide)  unchanged / target-changed / dev-changed / conflict
//
// Pure, so every row of that table is a test.

const ORIGIN = {
    TARGET_ADDED: 'target-added',
    TARGET_REMOVED: 'target-removed',
    TARGET_CHANGED: 'target-changed',
    DEV_ADDED: 'dev-added',
    DEV_REMOVED: 'dev-removed',
    DEV_CHANGED: 'dev-changed',
    BOTH: 'both',
    CONFLICT: 'conflict',
    UNCHANGED: 'unchanged',
    // No baseline could be read: every difference is shown, nothing is ticked,
    // and apply refuses. Never silently degrade to the two-way compare.
    UNKNOWN: 'unknown',
}

// Presence only. `values` decide the all-present case; pass them when the object
// has a comparable value (a type, a parent, a definition).
function originOf(base, prod, dev, { value = null } = {}) {
    // Callers may pass the values to compare explicitly; when they don't, the
    // arguments themselves are the values (presence-only callers pass booleans).
    const v = value ?? { base, prod, dev }
    const b = base != null, p = prod != null, d = dev != null
    if (!b && !p && !d) return ORIGIN.UNCHANGED
    if (!b && p && !d) return ORIGIN.TARGET_ADDED
    if (!b && !p && d) return ORIGIN.DEV_ADDED
    if (!b && p && d) return v.prod === v.dev ? ORIGIN.BOTH : ORIGIN.CONFLICT
    if (b && !p && !d) return ORIGIN.BOTH
    if (b && !p && d) return ORIGIN.TARGET_REMOVED
    if (b && p && !d) return ORIGIN.DEV_REMOVED
    // all three present: the values decide
    const prodMoved = v.prod !== v.base
    const devMoved = v.dev !== v.base
    if (!prodMoved && !devMoved) return ORIGIN.UNCHANGED
    if (prodMoved && !devMoved) return v.prod === v.dev ? ORIGIN.BOTH : ORIGIN.TARGET_CHANGED
    if (!prodMoved && devMoved) return v.prod === v.dev ? ORIGIN.BOTH : ORIGIN.DEV_CHANGED
    return v.prod === v.dev ? ORIGIN.BOTH : ORIGIN.CONFLICT
}

// What the refresh DOES with each origin — one table, so a plan row and an apply
// can never disagree.
function actionFor(origin) {
    switch (origin) {
        case ORIGIN.TARGET_ADDED:    return { offer: true,  tick: true,  apply: 'add' }
        case ORIGIN.TARGET_REMOVED:  return { offer: true,  tick: false, apply: 'remove' }   // needs a choice
        case ORIGIN.TARGET_CHANGED:  return { offer: true,  tick: false, apply: 'change' }   // decision (types clear values)
        case ORIGIN.DEV_REMOVED:     return { offer: false, tick: false, apply: 'none' }
        case ORIGIN.DEV_ADDED:       return { offer: false, tick: false, apply: 'none' }
        case ORIGIN.DEV_CHANGED:     return { offer: false, tick: false, apply: 'none' }
        case ORIGIN.CONFLICT:        return { offer: true,  tick: false, apply: 'conflict' }
        case ORIGIN.UNKNOWN:         return { offer: true,  tick: false, apply: 'none' }
        default:                     return { offer: false, tick: false, apply: 'none' }
    }
}

// One line a person can read, for a plan row.
function originLabel(origin, { what = 'it', target = 'PROD', source = 'DEV' } = {}) {
    switch (origin) {
        case ORIGIN.TARGET_ADDED:   return `${what} added on ${target} since the last deploy`
        case ORIGIN.TARGET_REMOVED: return `${what} removed on ${target} since the last deploy`
        case ORIGIN.TARGET_CHANGED: return `${what} changed on ${target} since the last deploy`
        case ORIGIN.DEV_REMOVED:    return `${what} removed on ${source} — not offered (Review reports the removal)`
        case ORIGIN.DEV_ADDED:      return `${what} added on ${source} — ships with this change set, not a refresh`
        case ORIGIN.DEV_CHANGED:    return `${what} changed on ${source} — ships with this change set`
        case ORIGIN.CONFLICT:       return `${what} changed on both sides, differently`
        case ORIGIN.UNKNOWN:        return `${what} differs — no baseline to say who changed it`
        default:                    return `${what} unchanged`
    }
}

module.exports = { ORIGIN, originOf, actionFor, originLabel }
