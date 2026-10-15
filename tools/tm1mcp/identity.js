'use strict'

// ── Who the MCP is, per call ─────────────────────────────────────────────────
// Two identities, never mixed silently:
//
//   reader  — every READ tool. When TM1_MCP_READ_USER is set this is that TM1
//             user's own login (Basic or CAM — TM1_MCP_READ_NAMESPACE), so TM1's
//             own cube / dimension / element / cell security decides what the
//             agent sees, exactly as it would for that person. Unset: reads run
//             as the service (builder) login, and start-up says so.
//   builder — every WRITE tool: the service login the change-set path has always
//             used. Each change-set row records both the developer (TM1_MCP_USER)
//             and this identity.
//
// Which one a call gets is decided by the tool wrapper (registry.js), not by each
// tool: it runs read tools inside asReader(), and client() looks it up. A tool
// can't forget to switch.
//
// Fail closed: a reader user that cannot be honoured (server reached through PAW,
// where there is no per-user login here) stops the MCP. It never falls back to the
// service login — that would quietly hand the agent more than the user can see.

const { AsyncLocalStorage } = require('async_hooks')

function createIdentity({ server, env = process.env, makeClient, makeClientWithCredentials }) {
    const readUser = env.TM1_MCP_READ_USER || null
    let builder = null, reader = null
    const readerState = {}                        // one TM1 session for every read call

    function builderClient() { return builder ??= makeClient(server, null) }

    function readClient() {
        if (!readUser) return builderClient()
        if (reader) return reader
        if (env.TM1_MCP_READ_PASSWORD == null) throw new Error('TM1_MCP_READ_USER is set but TM1_MCP_READ_PASSWORD is not — set both (empty string for a blank password)')
        reader = makeClientWithCredentials(server, {
            username:  readUser,
            password:  env.TM1_MCP_READ_PASSWORD,
            namespace: env.TM1_MCP_READ_NAMESPACE || undefined,
        }, readerState)
        if (!reader) throw new Error(`TM1_MCP_READ_USER is set, but "${server}" is reached through PAW — per-user reads need a direct connection. Not falling back to the service login.`)
        return reader
    }

    const als = new AsyncLocalStorage()
    const asReader  = fn => als.run('reader', fn)
    const asBuilder = fn => als.run('builder', fn)
    const current   = () => als.getStore() ?? 'builder'
    function client() { return current() === 'reader' ? readClient() : builderClient() }

    // Plain words for start-up and the audit: who reads, who writes.
    function describe() {
        return {
            reader:  readUser ? `${readUser}${env.TM1_MCP_READ_NAMESPACE ? ` (${env.TM1_MCP_READ_NAMESPACE})` : ''}` : 'service login',
            builder: 'service login',
            perUser: !!readUser,
        }
    }

    // Prove the reader login works before serving anything (and name it).
    async function verifyReader() {
        if (!readUser) return null
        const me = await readClient().get('ActiveUser', { '$select': 'Name' })
        return me?.Name ?? readUser
    }

    return { client, readClient, builderClient, asReader, asBuilder, current, describe, verifyReader, readUser }
}

module.exports = { createIdentity }
