'use strict'

// The change-set start route. Its read-only refusal is the important part; test
// the handler with a fake gate rather than searching server.js for the word.
function createStartSessionRoute({ gateReadOnly, startSession }) {
    return function startSessionRoute(req, res) {
        try {
            const { name, server } = req.body
            if (!name?.trim() || !server) return res.status(400).json({ error: 'name and server required' })
            if (!gateReadOnly(res, server)) return
            res.json(startSession(name.trim(), server, req.user))
        } catch (e) { res.status(500).json({ error: e.message }) }
    }
}

module.exports = { createStartSessionRoute }
