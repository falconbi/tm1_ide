'use strict'

const fs = require('fs')
const path = require('path')
const { z } = require('zod')

// The deploy tooling reads package files from disk. Do not let an agent choose
// an arbitrary directory: resolve the path under the IDE's packages root and
// refuse escapes (including symlinks), then require a manifest.
function packageDirFor(input) {
    const { PACKAGES_DIR } = require('../../../tools/tm1deploy/src/packager')
    // A fresh clone has no packages folder yet (it is git-ignored): nothing can be inside it.
    if (!fs.existsSync(PACKAGES_DIR)) throw new Error(`Package folder must be inside the packages root (${PACKAGES_DIR}), which does not exist yet; refusing ${input}`)
    const root = fs.realpathSync(PACKAGES_DIR)
    const candidate = path.isAbsolute(input) ? input : path.join(root, input)
    let resolved
    try { resolved = fs.realpathSync(candidate) }
    catch { throw new Error(`Package folder not found: ${input}`) }
    const rel = path.relative(root, resolved)
    if (rel.startsWith('..') || path.isAbsolute(rel)) {
        throw new Error(`Package folder must be inside the packages root (${root}); refusing ${input}`)
    }
    if (!fs.existsSync(path.join(resolved, 'manifest.json'))) {
        throw new Error(`No manifest.json found in ${resolved}`)
    }
    return resolved
}

// ══════════════════════════════════════════════════════════════════════════════
// DEPLOY — prepare & check against a target (no writes to the target)
// ══════════════════════════════════════════════════════════════════════════════

function register(server, { ok, assertTargetAllowed }) {
    server.tool(
        'check_deploy_risk',
        'Run the pre-deploy risk analysis for a package against a target server — rule/TI syntax on the target, missing dependencies, chore conflicts, structural impact. Read-only: nothing is written to the target. Use it as a fix loop before handoff: fix what it flags, re-package, re-check.',
        {
            packageDir: z.string().describe('Package folder path returned by package_change_set'),
            target:     z.string().describe('Target server name to check against, e.g. "TM1_Test"'),
        },
        async ({ packageDir, target }) => {
            const dir = packageDirFor(packageDir)
            let analyzeRisk
            try { ({ analyzeRisk } = require('../../../tools/tm1deploy/src/risk')) }
            catch (e) { throw new Error(`Deploy tooling not available: ${e.message}`, { cause: e }) }
            try {
                assertTargetAllowed(target)
                const r = await analyzeRisk(dir, target, null)
                return ok({
                    target,
                    safe_to_deploy: r.safe_to_deploy,
                    blockers: (r.blockers ?? []).map(b => `${b.type} ${b.name}: ${b.message}`),
                    warnings: (r.warnings ?? []).map(w => `${w.type} ${w.name}: ${w.message}`),
                    info_count: (r.infos ?? []).length,
                })
            } catch (e) { throw new Error(`risk check failed: ${e.message}`, { cause: e }) }
        }
    )

    server.tool(
        'check_target_drift',
        'Check whether a target server has drifted from the deployment baseline for the objects in a package — i.e. someone changed them on the target since the baseline was seeded. Read-only.',
        {
            packageDir: z.string().describe('Package folder path returned by package_change_set'),
            target:     z.string().describe('Target server name'),
        },
        async ({ packageDir, target }) => {
            const dir = packageDirFor(packageDir)
            let driftCheck
            try { ({ driftCheck } = require('../../../tools/tm1deploy/src/diff')) }
            catch (e) { throw new Error(`Deploy tooling not available: ${e.message}`, { cause: e }) }
            try {
                assertTargetAllowed(target)
                const r = await driftCheck(dir, target, null)
                if (r.skipped) return ok({ target, note: r.reason ?? 'drift check skipped (no baseline in the package or repo)' })
                return ok({
                    target,
                    target_aligned: r.target_aligned,
                    checked: r.checked,
                    drifted: (r.drifted ?? []).map(d => `${d.type} ${d.name}${d.detail ? ` (${d.detail})` : ''}: ${d.note ?? 'differs from baseline'}`),
                })
            } catch (e) { throw new Error(`drift check failed: ${e.message}`, { cause: e }) }
        }
    )
}

module.exports = { register }
