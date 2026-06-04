// Module-level registry for Apply callbacks from Filter → SubsetEditor flow.
// Keyed by tab.id. Survives component remounts without needing store serialisation.
export const subsetApplyCallbacks = new Map()
