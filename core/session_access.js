'use strict'

// One change set belongs to the person who started it. Admins may manage any;
// a missing legacy owner is treated as shared so old rows are not locked out.
function sameUser(a, b) {
    return String(a ?? '').trim().toLowerCase() === String(b ?? '').trim().toLowerCase()
}

function canManageSession(user, session, { isAdmin = false } = {}) {
    if (isAdmin) return true
    if (!session?.user) return true
    return sameUser(user, session.user)
}

module.exports = { sameUser, canManageSession }
