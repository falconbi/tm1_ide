'use strict'

// SaveDataAll is a server operation, not a model change: it writes all changed
// cube data to disk. Only TM1 administrators may trigger it through the IDE.
function isAdminGroups(groups = []) {
    return groups.some(g => String(g?.Name ?? g).trim().toLowerCase() === 'admin')
}

function createSaveDataAllRoute({ makeClient, gateReadOnly, writeLog }) {
    return async function saveDataAllRoute(req, res) {
        const server = req.body?.server
        if (!server) return res.status(400).json({ error: 'server required' })
        if (!gateReadOnly(res, server)) return

        try {
            const client = makeClient(server, req.ideToken)
            const me = await client.get('ActiveUser', { '$expand': 'Groups($select=Name)' })
            if (!isAdminGroups(me?.Groups)) {
                return res.status(403).json({ error: `Only TM1 admins can save data on ${server}.` })
            }

            const result = await client.saveDataAll()
            const savedAt = new Date().toISOString()
            writeLog({
                server,
                action: 'SAVE_DATA_ALL',
                objectType: 'server',
                objectName: server,
                detail: `Saved all changed data (${result.method})`,
                user: req.user,
            })
            res.json({ ok: true, server, savedAt, method: result.method })
        } catch (e) {
            const detail = e.response?.data?.error?.message ?? e.response?.data?.error ?? e.message
            res.status(500).json({ error: typeof detail === 'string' ? detail : JSON.stringify(detail) })
        }
    }
}

module.exports = { isAdminGroups, createSaveDataAllRoute }
