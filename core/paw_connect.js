'use strict'

const axios   = require('axios')
const { wrapper }   = require('axios-cookiejar-support')
const { CookieJar } = require('tough-cookie')
const { randomUUID } = require('crypto')

const PAW_HOST   = process.env.PAW_HOST
const SESSION_TTL = 600_000  // 10 minutes in ms

// Map<token, { username, password, session, expiry }>
const _sessions = new Map()

async function _login(username, password) {
    const jar = new CookieJar()
    const s   = wrapper(axios.create({ jar, withCredentials: true, timeout: 120_000 }))

    await s.post(`${PAW_HOST}/login/form/`,
        new URLSearchParams({ username, password, mode: 'basic' }),
        { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
    )

    const csrf = (await jar.getCookies(PAW_HOST))
        .find(c => c.key === 'ba-sso-csrf')?.value ?? ''

    if (!csrf) throw new Error('PAW login failed — ba-sso-csrf cookie not set')

    s._jar = jar
    return s
}

async function createSession(username, password) {
    const session = await _login(username, password)
    const token   = randomUUID()
    _sessions.set(token, { username, password, session, expiry: Date.now() + SESSION_TTL })
    return token
}

async function getCachedPawSession(token) {
    const entry = _sessions.get(token)
    if (!entry) throw new Error('Invalid or expired session — please log in again')
    if (Date.now() >= entry.expiry) {
        entry.session = await _login(entry.username, entry.password)
        entry.expiry  = Date.now() + SESSION_TTL
    }
    return entry.session
}

function getSessionUser(token) {
    return _sessions.get(token)?.username ?? null
}

function invalidateSession(token) {
    _sessions.delete(token)
}

async function getCSRF(session) {
    const cookies = await session._jar.getCookies(PAW_HOST)
    return cookies.find(c => c.key === 'ba-sso-csrf')?.value ?? ''
}

module.exports = { createSession, getCachedPawSession, getSessionUser, invalidateSession, getCSRF, PAW_HOST }
