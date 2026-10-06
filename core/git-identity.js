'use strict'

// ── Git identity ────────────────────────────────────────────────────────────
// Who TM1 Git commits as. Configurable per install via env — never hardcoded.

module.exports = {
    user:  () => process.env.TM1_GIT_USER  || 'git',
    email: () => process.env.TM1_GIT_EMAIL || 'git@localhost',
}
