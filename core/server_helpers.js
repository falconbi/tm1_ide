'use strict'

const path = require('path')

function createServerHelpers({ cl, makeClientWithCredentials, isDirectServer, PAW_LOGIN_SERVER, createCatalogOverrideRoutes, gateReadOnly, requireTm1Admin }) {
    const loginRateLimit = require('./login-rate-limit').createIpLimiter({ max: 10, windowMs: 15 * 60_000 })
    const SAMPLE_PASSWORD_WARNING = 'This server still uses IBM\'s published sample password (admin / apple) — change it before anyone else can reach it.'
    const isSampleLogin = (u, p) => String(u ?? '').toLowerCase() === 'admin' && p === 'apple'
    const SQL_PASSWORD_MASK = '••••••••'
    const _GI = () => require('./git-identity')
    const _GITOK = () => process.env.TM1_GIT_TOKEN || ''
    const CATALOG_OVERRIDES_PATH = path.join(__dirname, '..', 'config', 'function-catalog-overrides.json')
    const catalogRoutes = createCatalogOverrideRoutes({
        filePath: CATALOG_OVERRIDES_PATH,
        requireTm1Admin,
        gateReadOnly,
        serverOf: req => req.query.server ?? req.body?.server ?? PAW_LOGIN_SERVER,
    })
    const LENS_CATALOGUE = JSON.stringify(require('../shared/lens-components.json'), null, 1)
    const txLogSearches = new Map()
    const lensUsageCache = new Map()
    const userServer = req => req.query?.server ?? req.body?.server ?? PAW_LOGIN_SERVER

    async function closeServerSession(server, entry) {
        if (!entry?.state?.cookie) return
        const cl = makeClientWithCredentials(server, { username: entry.username, password: entry.password ?? '' }, entry.state)
        await cl?._adapter?.closeSession?.()
    }

    async function setupBlankAdmin(server, newPassword) {
        const fail = (status, body) => Object.assign(new Error(body.error), { status, body })
        if (!server) throw fail(400, { error: 'server required' })
        if (!newPassword) throw fail(400, { error: 'newPassword required' })
        if (!isDirectServer(server)) throw fail(400, { error: `"${server}" is reached through PAW — set its password there` })
        const blank = makeClientWithCredentials(server, { username: 'admin', password: '' }, {})
        try {
            await blank.get('ActiveUser', { '$select': 'Name' })
        } catch (e) {
            if (e.code !== 'TM1_AUTH_REJECTED') throw e
            const w = String(e.wwwAuthenticate ?? '').toLowerCase()
            const mode = /cam/.test(w) ? 'cam' : /negotiate|ntlm/.test(w) ? 'integrated' : 'native'
            throw fail(409, {
                mode, alreadyHasPassword: mode === 'native',
                error: mode === 'native'
                    ? `"${server}" already has an admin password — sign in to it normally`
                    : `"${server}" uses ${mode === 'cam' ? 'CAM (Cognos)' : 'Windows'} security — passwords are managed in the directory, not TM1`,
            })
        }
        await blank.patch("Users('admin')", { Password: newPassword })
        await blank._adapter.closeSession()
        const state = {}
        await makeClientWithCredentials(server, { username: 'admin', password: newPassword }, state).get('ActiveUser', { '$select': 'Name' })
        return { state }
    }

    const sendSetupError = (res, e) => e.status
        ? res.status(e.status).json(e.body)
        : res.status(500).json({ error: e.response?.data?.error?.message ?? e.message })

    function logAttributeValue({ server, dimension, element, attribute, hierarchy, before, after, user }) {
        if (String(before ?? '') === String(after ?? '')) return
        try {
            cl.writeLog({
                server,
                action: 'ATTRIBUTE_VALUE_SET',
                objectType: 'attribute-value',
                objectName: `${dimension}:${element}:${attribute}`,
                detail: { dimension, hierarchy: hierarchy ?? dimension, element, attribute, before: before ?? null, after: after ?? null },
                user,
            })
        } catch { /* history must not block the value write */ }
    }

    const HANGING_KW = /\b(IF|WHILE|ELSEIF)\s*$/i
    function joinContinuations(code) {
        let out = '', depth = 0, inStr = false, lineBuffer = ''
        for (let i = 0; i < code.length; i++) {
            const ch = code[i]
            if (inStr) {
                if (ch === "'") {
                    if (code[i + 1] === "'") { out += "''"; lineBuffer += "''"; i++ }
                    else { inStr = false; out += ch; lineBuffer += ch }
                } else { out += ch; lineBuffer += ch }
            } else {
                if (ch === '#') {
                    out += '#'
                    while (i + 1 < code.length && code[i + 1] !== '\n') { out += code[++i] }
                }
                else if (ch === "'") { inStr = true; out += ch; lineBuffer += ch }
                else if (ch === '(') { depth++; out += ch; lineBuffer += ch }
                else if (ch === ')') { depth--; out += ch; lineBuffer += ch }
                else if (ch === '\n') {
                    out += (depth > 0 || HANGING_KW.test(lineBuffer)) ? ' ' : '\n'
                    lineBuffer = ''
                }
                else { out += ch; lineBuffer += ch }
            }
        }
        return out
    }

    function parseDbRefs(rules) {
        const refs = new Set()
        const re = /\bDB[S]?\s*\(\s*'([^']+)'/gi
        let m
        while ((m = re.exec(rules)) !== null) refs.add(m[1])
        return [...refs]
    }

    return {
        loginRateLimit, SAMPLE_PASSWORD_WARNING, isSampleLogin, SQL_PASSWORD_MASK, _GI, _GITOK,
        CATALOG_OVERRIDES_PATH, catalogRoutes, LENS_CATALOGUE, txLogSearches, lensUsageCache, userServer,
        closeServerSession, setupBlankAdmin, sendSetupError, logAttributeValue, joinContinuations,
        parseDbRefs,
    }
}

module.exports = { createServerHelpers }
