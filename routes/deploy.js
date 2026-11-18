'use strict'

function register(app, deps) {
    const { _GI, _GITOK, cl, deployLoadBaseline, deploySeed, fail, fs, gateReadOnly, gitSecrets, listServers, makeClient, path, requireTm1Admin } = deps

app.post('/api/deploy/pre-delete-check', async (req, res) => {
    try {
        const { server, dimension, element, hierarchy } = req.body
        if (!server || !dimension || !element) return res.status(400).json({ error: 'server, dimension and element required' })
        const client = makeClient(server, req.ideToken)
        res.json(await client.preDeleteElementCheck(dimension, element, hierarchy ?? dimension))
    } catch (e) { res.status(500).json({ error: e.message }) }
})

app.get('/api/deploy/baseline', (req, res) => {
    try {
        const snapshot = deployLoadBaseline(null, req.query.server)
        if (!snapshot) return res.json({ exists: false })
        res.json({ exists: true, ...snapshot._meta })
    } catch (e) { res.status(500).json({ error: e.message }) }
})

app.get('/api/git-readiness', async (req, res) => {
    try {
        const { scan } = require('../core/git-readiness')
        const { listServers } = require('../core/adapter-registry')
        if (req.query.all === '1') {
            const results = []
            for (const s of listServers()) {
                try { results.push(await scan(s, { ideToken: req.ideToken })) }
                catch (e) { results.push({ server: s, error: e.message }) }
            }
            return res.json({ results })
        }
        if (!req.query.server) return res.status(400).json({ error: 'server or all=1 required' })
        res.json(await scan(req.query.server, { ideToken: req.ideToken }))
    } catch (e) { res.status(500).json({ error: e.message }) }
})

app.post('/api/deploy/git/prepare', async (req, res) => {
    try {
        const { prepare } = require('../core/git-deploy')
        const { source, target, branch, session } = req.body
        if (!source || !target) return res.status(400).json({ error: 'source and target required' })
        res.json(await prepare(source, target, { branch, token: _GITOK(), ideToken: req.ideToken, session }))
    } catch (e) { res.status(500).json({ error: e.message }) }
})

app.post('/api/deploy/git/execute', async (req, res) => {
    try {
        // Not gated by read-only: a recorded approval (enforced inside execute(),
        // non-optionally) is what authorises shipping to a PROD-posture target.
        const { execute } = require('../core/git-deploy')
        const { target, branch, source, session } = req.body
        if (!target) return res.status(400).json({ error: 'target required' })
        const result = await execute(target, { branch, token: _GITOK(), ideToken: req.ideToken, source, by: req.user, session })
        if (result?.missingSource) return res.status(400).json({ error: result.error })
        if (result?.approvalSession && result?.executed && result?.controlOk) try { cl.markSessionDeployed(result.approvalSession, target) } catch { /* link is best-effort */ }
        res.json(result)
    } catch (e) { res.status(500).json({ error: e.message }) }
})

app.post('/api/deploy/git/push', async (req, res) => {
    try {
        if (!gateReadOnly(res, req.body?.source)) return
        const { source, branch = 'dev', message, session } = req.body
        if (!source) return res.status(400).json({ error: 'source required' })
        const changeSet = session ? cl.getSession(session) : null
        if (changeSet?.wont_deploy_at) {
            return res.status(409).json({ error: `Change set "${changeSet.name}" is marked won't deploy — unmark it before committing.` })
        }
        const { pushReadiness } = require('../core/git-readiness')
        const readiness = await pushReadiness(source, { ideToken: req.ideToken })
        if (!readiness.ok) {
            return res.status(409).json({
                error: `Readiness blockers must be fixed before pushing: ${readiness.blockers.join('; ')}`,
                blockers: readiness.blockers,
                readiness: readiness.readiness,
            })
        }
        const c = makeClient(source, req.ideToken)
        const gi = require('../core/git-identity')
        const creds = { Username: gi.user(), Password: _GITOK() }
        const plan = await c.post('GitPush', {
            Branch: branch, NewBranch: '', Force: false,
            Message: message || `Deploy from ${source}`,
            Author: req.user ?? gi.user(), Email: gi.email(), ...creds,
        })
        await c.post(`GitPlans('${encodeURIComponent(plan.ID)}')/tm1.Execute`, {})
        if (session) try { cl.setSessionCommit(session, plan.NewCommit?.ID ?? null) } catch { /* link is best-effort */ }
        res.json({ pushed: true, commit: plan.NewCommit?.ID ?? null, summary: plan.NewCommit?.Summary ?? null, readiness: readiness.readiness })
    } catch (e) { res.status(500).json({ error: e.message }) }
})

// Targets with a recorded deployed commit — the only ones a catch-up can bring
// level. Admin-only: the catch-up is an explicit, reviewed whole-model release.
app.get('/api/deploy/git/catch-up/targets', async (req, res) => {
    try {
        const source = req.query.source
        if (!source) return res.status(400).json({ error: 'source required' })
        if (!(await requireTm1Admin(req, res, source))) return
        const { lastDeployed } = require('../core/git-state')
        const targets = (listServers() ?? [])
            .filter(t => t !== source)
            .map(target => ({ target, ...(lastDeployed(target) ?? {}) }))
            .filter(t => t.lastDeployedCommit)
            .map(({ target, lastDeployedCommit, at }) => ({ target, lastDeployedCommit, at: at ?? null }))
        res.json({ source, targets })
    } catch (e) { res.status(500).json({ error: e.message }) }
})

// Start a catch-up: a TM1 admin types the sentence and the server creates the
// closed, empty catch-up change set. It builds like any other release after.
app.post('/api/deploy/git/catch-up', async (req, res) => {
    try {
        const { source, target, confirm } = req.body
        if (!source || !target) return res.status(400).json({ error: 'source and target required' })
        if (!(await requireTm1Admin(req, res, source))) return
        const { startCatchUp } = require('../core/git-catchup')
        const r = await startCatchUp({
            source, target, confirm, user: req.user,
            token: _GITOK(), gitUser: _GI().user(), ideToken: req.ideToken,
        })
        if (r.refused) return res.status(409).json({ error: r.error })
        res.json(r)
    } catch (e) { res.status(500).json({ error: e.message }) }
})

app.post('/api/deploy/git/release', async (req, res) => {
    try {
        const { target, session } = req.body
        if (!target) return res.status(400).json({ error: 'target required' })
        const changeSet = session ? cl.getSession(session) : null
        if (!changeSet) return res.status(400).json({ error: 'a change set (session) is required' })
        if (changeSet.wont_deploy_at) {
            return res.status(409).json({ error: `Change set "${changeSet.name}" is marked won't deploy — unmark it before releasing.` })
        }
        const catchUp = changeSet.kind === 'catch-up'
        if (catchUp && !(await requireTm1Admin(req, res, changeSet.server))) return
        const { buildRelease } = require('../core/git-release')
        const addObjects = Array.isArray(req.body.addObjects) ? req.body.addObjects : []
        const r = await buildRelease(changeSet, target, {
            token: _GITOK(), gitUser: _GI().user(), ideToken: req.ideToken,
            addObjects, by: req.user ?? null, catchUp,
        })
        if (r.refused) return res.status(409).json({ error: r.error })
        if (r.ok === false) return res.status(500).json({ error: r.error })
        cl.setSessionRelease(changeSet.id, r.releaseCommit, target, {
            addedByUser: r.addedByUser,
            addedAsDependency: r.addedAsDependency,
            coveredSets: catchUp ? (r.coveredSets ?? []).map(s => s.id) : undefined,
        })
        res.json(r)
    } catch (e) { res.status(500).json({ error: e.message }) }
})

app.post('/api/deploy/git/approve', async (req, res) => {
    try {
        const { source, target, commit, note } = req.body
        if (!target || !commit) return res.status(400).json({ error: 'target and commit required' })
        const approvals = require('../core/git-approvals')
        // Rule 1: only a BUILT RELEASE links to an approval (release_commit, built
        // for this exact target) — never a raw DEV commit_ref, and never a release
        // built for a different target. linkedChangeSet enforces both.
        const linkedSession = approvals.linkedChangeSet(commit, target)
        if (!linkedSession) {
            return res.status(409).json({ error: `Refused: commit ${commit} is not a release built for ${target}. Build the release first, then approve it.` })
        }
        let tests = null
        try { tests = linkedSession.close_tests ? JSON.parse(linkedSession.close_tests) : null } catch { tests = null }
        if (!tests || tests.blocking > 0) {
            return res.status(409).json({ error: `Refused: the change set for commit ${commit} has failing block-severity tests. Fix and re-close before approving.` })
        }
        // Dependency check before approval: rules must CheckRules clean on the target
        // and processes must pass TI lint — a failed reference may belong to another
        // change set (release that change set first, then rebuild this release).
        if (linkedSession.release_commit) {
            const { checkDependencies } = require('../core/git-release')
            const dep = await checkDependencies(linkedSession.release_commit, target, { token: _GITOK(), gitUser: _GI().user(), ideToken: req.ideToken })
            if (!dep.ok) {
                return res.status(409).json({ error: `Refused: the release has failing dependencies — ${(dep.blockers ?? []).map(b => `${b.object}: ${b.message}`).join(' | ') || dep.error}`, blockers: dep.blockers ?? [] })
            }
        }
        const parseList = (text) => { try { return text ? JSON.parse(text) : [] } catch { return [] } }
        const rec = await approvals.append({
            id: new Date().toISOString(), approved_at: new Date().toISOString(),
            approver: req.user ?? 'unknown', notes: note ?? '',
            source: source ?? null, target, commit, session: linkedSession.id, packageDir: null,
            addedByUser: parseList(linkedSession.release_added_by_user),
            addedAsDependency: parseList(linkedSession.release_added_as_dependency),
        }, { ideToken: req.ideToken })
        res.json(rec)
    } catch (e) { res.status(500).json({ error: e.message }) }
})

app.get('/api/deploy/git/approval', async (req, res) => {
    try {
        const approvals = require('../core/git-approvals')
        res.json(await approvals.find(req.query.target, req.query.commit, { ideToken: req.ideToken }))
    } catch (e) { res.status(500).json({ error: e.message }) }
})

app.post('/api/git/drift', async (req, res) => {
    try {
        const { driftCheck } = require('../core/git-drift')
        const server = req.body?.server ?? req.query.server
        if (!server) return res.status(400).json({ error: 'server required' })
        res.json(await driftCheck(server, { token: _GITOK(), ideToken: req.ideToken }))
    } catch (e) { res.status(500).json({ error: e.message }) }
})

app.get('/api/git/lock', async (req, res) => {
    try {
        const { current } = require('../core/git-lock')
        const server = req.query?.server
        if (!server) return res.status(400).json({ error: 'server required' })
        res.json(await current(server, { ideToken: req.ideToken }))
    } catch (e) { res.status(500).json({ error: e.message }) }
})

app.post('/api/git/lock/clear', async (req, res) => {
    try {
        const { clear } = require('../core/git-lock')
        const server = req.body?.server
        if (!server) return res.status(400).json({ error: 'server required' })
        const result = await clear(server, { by: req.user, ideToken: req.ideToken })
        res.json(result)
    } catch (e) {
        res.status(e.refused ? 409 : 500).json({ error: e.message })
    }
})

app.get('/api/git/setup/status', async (req, res) => {
    const tokenSource = gitSecrets.tokenSource()
    try {
        const server = req.query?.server
        if (!server) return res.status(400).json({ error: 'server required', tokenSource })
        const st = await makeClient(server, req.ideToken).post('GitStatus', { Username: _GI().user(), Password: _GITOK() })
        res.json({ linked: !!st?.URL, repoUrl: st?.URL ?? null, deployment: st?.Deployment ?? null, connected: st?.Remote?.Connected ?? false, tokenSource })
    } catch (e) {
        res.status(502).json({
            error: `${e.message} — the token may have expired; it needs Contents: Read and write on the repo`,
            tokenSource,
        })
    }
})

app.post('/api/git/setup/token', (req, res) => {
    try {
        gitSecrets.setToken(req.body?.token)
        res.json({ ok: true, note: 'token set ✓' })   // never the token itself
    } catch (e) { res.status(e.status ?? 400).json({ error: e.message }) }
})

app.get('/api/git/setup/readiness', async (req, res) => {
    try {
        const { server } = req.query
        if (!server) return res.status(400).json({ error: 'server required' })
        const { scan } = require('../core/git-readiness')
        res.json(await scan(server, { gitUser: _GI().user(), token: _GITOK(), ideToken: req.ideToken }))
    } catch (e) { res.status(500).json({ error: e.message }) }
})

app.post('/api/git/setup/init', async (req, res) => {
    try {
        const { server, repo, deployment, force } = req.body
        if (!server || !repo || !deployment) return res.status(400).json({ error: 'server, repo and deployment required' })
        if (!/^(DEV|TEST|PROD)$/i.test(deployment)) return res.status(400).json({ error: 'deployment should be DEV, TEST or PROD' })
        const { init } = require('../core/git-setup')
        const r = await init(server, { repo, deployment, force, gitUser: _GI().user(), token: _GITOK(), ideToken: req.ideToken })
        if (r.refused) return res.status(409).json({ error: r.error })
        res.json(r)
    } catch (e) { fail(res, e) }
})

app.post('/api/git/setup/first-push', async (req, res) => {
    try {
        const { server, message } = req.body
        if (!server) return res.status(400).json({ error: 'server required' })
        const c = makeClient(server, req.ideToken)
        const plan = await c.post('GitPush', { Branch: 'dev', NewBranch: '', Force: false, Message: message || `Initial state of ${server}`, Author: req.user ?? _GI().user(), Email: _GI().email(), Username: _GI().user(), Password: _GITOK() })
        await c.post(`GitPlans('${encodeURIComponent(plan.ID)}')/tm1.Execute`, {})
        res.json({ ok: true, commit: plan.NewCommit?.ID ?? null, note: `First commit of ${server} pushed to the repo.` })
    } catch (e) { fail(res, e) }
})

app.get('/api/git/setup/first-pull-analysis', async (req, res) => {
    try {
        const { server, branch = 'dev' } = req.query
        if (!server) return res.status(400).json({ error: 'server required' })
        const { firstPullAnalysis } = require('../core/git-readiness')
        res.json(await firstPullAnalysis(server, { branch, gitUser: _GI().user(), token: _GITOK(), ideToken: req.ideToken }))
    } catch (e) { fail(res, e) }
})

app.post('/api/git/setup/first-pull', async (req, res) => {
    try {
        const { server, branch = 'dev', confirm } = req.body
        if (!server) return res.status(400).json({ error: 'server required' })
        const { firstPull } = require('../core/git-setup')
        const r = await firstPull(server, { branch, confirm, gitUser: _GI().user(), token: _GITOK(), ideToken: req.ideToken })
        if (r.refused) return res.status(409).json({ error: r.error })
        if (r.ok === false) return res.status(400).json({ error: r.error })
        res.json(r)
    } catch (e) { fail(res, e) }
})

app.post('/api/deploy/seed', async (req, res) => {
    try {
        const { server, label } = req.body
        if (!server) return res.status(400).json({ error: 'server required' })
        // stamp the change-log position so releases can window on id, not timestamp
        const extraMeta = { last_entry_id: cl.getMaxEntryId(server) }
        if (label) extraMeta.label = String(label)
        const snapshot = await deploySeed(server, null, req.ideToken, extraMeta)
        res.json({ ok: true, server, seeded_at: snapshot._meta.seeded_at, last_entry_id: snapshot._meta.last_entry_id, counts: snapshot._meta.counts })
    } catch (e) { res.status(500).json({ error: e.message }) }
})

app.get('/api/deploy/git/history', async (req, res) => {
    try {
        const target = req.query.target
        if (!target) return res.status(400).json({ error: 'target required' })
        const state = require('../core/git-state').load()[target] ?? null
        const approvals = await require('../core/git-approvals').readFor(target, { ideToken: req.ideToken })
        // Link each approval to its change set so History can show the kind
        // (a catch-up reads "Catch-up", not an ordinary change set).
        const enriched = approvals.map(a => {
            const session = a.session ? cl.getSession(a.session) : null
            return { ...a, sessionName: session?.name ?? null, sessionKind: session?.kind ?? null }
        })
        res.json({ target, deploy: state, approvals: enriched })
    } catch (e) { res.status(500).json({ error: e.message }) }
})

app.get('/api/deploy/archives', (req, res) => {
    try {
        const dir = path.join(__dirname, '..', 'data', 'archives')
        if (!fs.existsSync(dir)) return res.json([])
        const archives = fs.readdirSync(dir)
            .filter(f => f.endsWith('.json'))
            .sort().reverse()
            .map(f => {
                try {
                    const data = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'))
                    return { id: f.replace('.json', ''), archived_at: data.archived_at, source: data.source, target: data.target, deployer: data.deployer, approval: data.approval, deployStats: { deployed: data.deploy?.deployed, failed: data.deploy?.failed, dry_run: data.deploy?.dry_run } }
                } catch { return null }
            })
            .filter(Boolean)
        res.json(archives)
    } catch (e) { res.status(500).json({ error: e.message }) }
})

app.get('/api/deploy/archives/:id', (req, res) => {
    try {
        const file = path.join(__dirname, '..', 'data', 'archives', `${req.params.id}.json`)
        if (!fs.existsSync(file)) return res.status(404).json({ error: 'Not found' })
        res.json(JSON.parse(fs.readFileSync(file, 'utf8')))
    } catch (e) { res.status(500).json({ error: e.message }) }
})
}

module.exports = { register }
