// Cube Map trail — every drill since the full map, like browser history.
// A step is { kind: 'node' | 'module' | 'dim', id } — a 'dim' step filters the step before it
// to the cubes using that dimension. Pure functions so the rules are tested.

const sameStep = (a, b) => !!a && !!b && a.kind === b.kind && a.id === b.id

// A drill adds a step. Revisiting a cube adds it again — the trail is the path
// you took, not a set. Only a repeat of the current step (e.g. the two clicks of
// a double-click) is ignored.
export function pushStep(trail, step) {
  return sameStep(trail[trail.length - 1], step) ? trail : [...trail, step]
}

// Jump back to step `index`: it becomes the current step, later steps go.
export function backTo(trail, index) {
  return index >= 0 && index < trail.length ? trail.slice(0, index + 1) : trail
}

// Back one step: the step to show, or null to leave focus for the full map.
export function previousStep(trail) {
  return trail.length > 1 ? trail[trail.length - 2] : null
}
