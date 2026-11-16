'use strict'

// One factory for the small admin mutations. The route body stays a one-liner in
// server.js; the behaviour (admin check before the TM1 call) is testable here.
function createCancelJobRoute({ makeClient, requireTm1Admin }) {
    return async function cancelJobRoute(req, res) {
        try {
            if (!(await requireTm1Admin(req, res, req.query.server))) return
            await makeClient(req.query.server, req.ideToken).cancelJob(req.query.id)
            res.json({ ok: true })
        } catch (e) { res.status(500).json({ error: e.message }) }
    }
}

module.exports = { createCancelJobRoute }
