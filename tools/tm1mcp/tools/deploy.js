'use strict'

const { z } = require('zod')

// ══════════════════════════════════════════════════════════════════════════════
// DEPLOY — prepare & check against a target (no writes to the target)
// ══════════════════════════════════════════════════════════════════════════════

function register(server, { ok }) {
    server.tool(
        'check_deploy_risk',
        'Run the pre-deploy risk analysis for a package against a target server — rule/TI syntax on the target, missing dependencies, chore conflicts, structural impact. Read-only: nothing is written to the target. Use it as a fix loop before handoff: fix what it flags, re-package, re-check.',
        {
            packageDir: z.string().describe('Package folder path returned by package_change_set'),
            target:     z.string().describe('Target server name to check against, e.g. "TM1_Test"'),
        },
        async ({ packageDir, target }) => {
            let analyzeRisk
            try { ({ analyzeRisk } = require('../../../tools/tm1deploy/src/risk')) }
            catch (e) { return ok(`Deploy tooling not available: ${e.message}`) }
            try {
                const { assertTargetAllowed } = require('../shared')
                assertTargetAllowed(target)
                const r = await analyzeRisk(packageDir, target, null)
                return ok({
                    target,
                    safe_to_deploy: r.safe_to_deploy,
                    blockers: (r.blockers ?? []).map(b => `${b.type} ${b.name}: ${b.message}`),
                    warnings: (r.warnings ?? []).map(w => `${w.type} ${w.name}: ${w.message}`),
                    info_count: (r.infos ?? []).length,
                })
            } catch (e) { return ok(`risk check failed: ${e.message}`) }
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
            let driftCheck
            try { ({ driftCheck } = require('../../../tools/tm1deploy/src/diff')) }
            catch (e) { return ok(`Deploy tooling not available: ${e.message}`) }
            try {
                const { assertTargetAllowed } = require('../shared')
                assertTargetAllowed(target)
                const r = await driftCheck(packageDir, target, null)
                if (r.skipped) return ok({ target, note: r.reason ?? 'drift check skipped (no baseline in the package or repo)' })
                return ok({
                    target,
                    target_aligned: r.target_aligned,
                    checked: r.checked,
                    drifted: (r.drifted ?? []).map(d => `${d.type} ${d.name}${d.detail ? ` (${d.detail})` : ''}: ${d.note ?? 'differs from baseline'}`),
                })
            } catch (e) { return ok(`drift check failed: ${e.message}`) }
        }
    )
}

module.exports = { register }
