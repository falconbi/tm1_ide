'use strict'

// Objects that must never be packaged or deployed.
//
// WFP_Lab is a test model built inside the real development server with names
// that start "LAB ". It shares the server and change log with Workforce, so a
// release package can otherwise pick it up. Keep this list narrow and explicit:
// a false positive here silently drops a real object from a deploy.
//
// Bedrock is a third-party library we no longer use (the IDE's own tools and
// MCP cover what it did). It must not ride into a package: a package built from
// a server that still has it installed would otherwise ship 91 processes, 29
// scratch dimensions and their scratch cube.
const LAB_PATTERNS = [
    /^LAB /,                    // LAB dimensions, cubes, processes
    /^}ElementAttributes_LAB/,  // attribute cubes for LAB dimensions
]
const BEDROCK_PATTERNS = [
    /^[}_]bedrock\./i,          // }bedrock.* in TM1, _bedrock.* in package files
    /^}ElementAttributes_}bedrock/i,
]
const NEVER_DEPLOY = [...LAB_PATTERNS, ...BEDROCK_PATTERNS]

function names(item) {
    if (typeof item === 'string') return [item]
    if (!item || typeof item !== 'object') return []
    return [item.object_name, item.name, item.detail, item.object_detail].filter(n => typeof n === 'string' && n)
}

function isNeverDeploy(item) {
    return names(item).some(n => NEVER_DEPLOY.some(re => re.test(n)))
}

function isLabObject(item) {
    return names(item).some(n => LAB_PATTERNS.some(re => re.test(n)))
}

module.exports = { isNeverDeploy, isLabObject, NEVER_DEPLOY, LAB_PATTERNS, BEDROCK_PATTERNS }
