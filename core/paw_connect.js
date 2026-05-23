'use strict'

const axios    = require('axios')
const { wrapper }    = require('axios-cookiejar-support')
const { CookieJar }  = require('tough-cookie')

const PAW_HOST     = process.env.PAW_HOST
const PAW_USERNAME = process.env.PAW_USERNAME
const PAW_PASSWORD = process.env.PAW_PASSWORD
const SESSION_TTL  = 600_000  // 10 minutes in ms

let _session = null
let _expiry  = 0

async function getPawSession() {
    const jar = new CookieJar()
    const s   = wrapper(axios.create({ jar, withCredentials: true, timeout: 120_000 }))

    await s.post(`${PAW_HOST}/login/form/`,
        new URLSearchParams({ username: PAW_USERNAME, password: PAW_PASSWORD, mode: 'basic' }),
        { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
    )

    const csrf = (await jar.getCookies(PAW_HOST))
        .find(c => c.key === 'ba-sso-csrf')?.value ?? ''

    if (!csrf) throw new Error('PAW login failed — ba-sso-csrf cookie not set')

    s._jar = jar
    return s
}

async function getCachedPawSession() {
    if (_session && Date.now() < _expiry) return _session
    _session = await getPawSession()
    _expiry  = Date.now() + SESSION_TTL
    return _session
}

function invalidateSession() {
    _session = null
    _expiry  = 0
}

async function getCSRF(session) {
    const cookies = await session._jar.getCookies(PAW_HOST)
    return cookies.find(c => c.key === 'ba-sso-csrf')?.value ?? ''
}

module.exports = { getPawSession, getCachedPawSession, invalidateSession, getCSRF, PAW_HOST }
