'use strict'

// Objects that must never be packaged or deployed.
//
// WFP_Lab is a test model built inside the real development server with names
// that start "LAB ". It shares the server and change log with Workforce, so a
// release package can otherwise pick it up. Keep this list narrow and explicit:
// a false positive here silently drops a real object from a deploy.
const NEVER_DEPLOY = [
    /^LAB /,                    // LAB dimensions, cubes, processes
    /^}ElementAttributes_LAB/,  // attribute cubes for LAB dimensions
]

function isNeverDeploy(name) {
    const s = String(name ?? '')
    return NEVER_DEPLOY.some(re => re.test(s))
}

module.exports = { isNeverDeploy, NEVER_DEPLOY }
