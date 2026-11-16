// Keyboard shortcuts (Ctrl+F / Ctrl+Shift+A) belong to the grid that has focus,
// not every grid mounted in a split workspace. The toolbar passes its wrapper.
export function inGridScope(scope, event) {
    if (!scope) return true
    const active = typeof document !== 'undefined' ? document.activeElement : null
    return !!scope.contains(event?.target) || !!(active && scope.contains(active))
}
