'use strict'

// Does the one-button Ship stop and ask before sending?
//
// Ship reads the release before approving it. If that release would remove
// elements from the target, the person has to see them and say so — otherwise
// the quick path is also the blind one, and elements carry their data with them.
// If nothing is removed there is no extra step: normal changes stay one click.
//
// Kept as a pure decision (and as a .cjs the client imports through a thin ESM
// re-export) so it can be tested without a browser, a server or a release.

/**
 * @param {{ loss?: { elements?: number } | null, confirmed?: boolean }} input
 * @returns {'pass'|'confirm'}
 */
function decideLossGate({ loss, confirmed } = {}) {
    const elements = Number(loss?.elements ?? 0)
    if (elements > 0 && !confirmed) return 'confirm'
    return 'pass'
}

module.exports = { decideLossGate }
