'use strict'

// The UI's one user-creation path. It must use provisionUser (two TI runs), not
// createClient + a separate group patch: TM1 commits a new client only at the end
// of the run that added it, so a password in the same run is silently lost.
function createProvisionUserRoute({ makeClient, gateReadOnly, requireTm1Admin, userServer, fail }) {
    return async function provisionUserRoute(req, res) {
        try {
            const server = userServer(req)
            if (!gateReadOnly(res, server)) return
            if (!(await requireTm1Admin(req, res, server))) return
            const { name, password, friendlyName = '', groups = [] } = req.body
            await makeClient(server, req.ideToken).provisionUser(name, password, groups, friendlyName)
            res.json({ ok: true })
        } catch (e) {
            console.error('[provisionUser]', e.response?.status, e.message)
            fail(res, e)
        }
    }
}

module.exports = { createProvisionUserRoute }
