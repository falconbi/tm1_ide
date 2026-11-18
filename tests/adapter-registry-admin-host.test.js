'use strict'
// A wrong "url" in servers.json used to surface as "Could not reach … 401",
// which reads as a password problem. The Admin Server lookup now names the
// cause and the sign-in route reports it as a setup problem.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const path = require('path')
const axios = require('axios')

const SERVERS_PATH = path.join(__dirname, '..', 'config', 'servers.json')
const REGISTRY = require.resolve('../core/adapter-registry')

const cfg = {
    adminHosts: [{
        name: 'Lab', url: 'http://localhost:5895', adapter: 'direct-v11', servers: ['DEV'],
    }],
}

// Serve a fake servers.json and a fake axios.get, then load a fresh registry
// so its URL cache is empty for each case.
async function withRegistry(fakeGet, fn) {
    const real = { statSync: fs.statSync, readFileSync: fs.readFileSync, get: axios.get }
    fs.statSync = (p, ...rest) => (p === SERVERS_PATH ? { mtimeMs: Math.random() } : real.statSync(p, ...rest))
    fs.readFileSync = (p, ...rest) => (p === SERVERS_PATH ? JSON.stringify(cfg) : real.readFileSync(p, ...rest))
    axios.get = fakeGet
    delete require.cache[REGISTRY]
    try {
        return await fn(require('../core/adapter-registry'))
    } finally {
        Object.assign(fs, { statSync: real.statSync, readFileSync: real.readFileSync })
        axios.get = real.get
        delete require.cache[REGISTRY]
    }
}

test('401 from the address means it is a TM1 server, not the Admin Server', async () => {
    const err401 = Object.assign(new Error('Request failed with status code 401'), { response: { status: 401 } })
    await withRegistry(async () => { throw err401 }, async (reg) => {
        await assert.rejects(
            reg.probeAuthMethod('DEV'),
            (e) => e.code === 'ADMIN_HOST_LOOKUP'
                && /answered as a TM1 server, not the TM1 Admin Server/.test(e.message)
                && /usually port 5895 \(HTTP\) or 5898 \(HTTPS\)/.test(e.message),
        )
    })
})

test('a refused connection names the Admin Server as unreachable', async () => {
    const refused = Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:5895'), { code: 'ECONNREFUSED' })
    await withRegistry(async () => { throw refused }, async (reg) => {
        await assert.rejects(
            reg.probeAuthMethod('DEV'),
            (e) => e.code === 'ADMIN_HOST_LOOKUP'
                && e.message === `Can't reach the TM1 Admin Server at http://localhost:5895. Check "url" in config/servers.json and that the Admin Server service is running.`,
        )
    })
})

test('a missing server name lists the names the Admin Server did return', async () => {
    const answer = { data: { value: [{ Name: '24retail' }, { Name: 'TM1_Test_DEV' }] } }
    await withRegistry(async () => answer, async (reg) => {
        cfg.adminHosts[0].servers = ['Nope']
        try {
            await assert.rejects(
                reg.probeAuthMethod('Nope'),
                (e) => e.code === 'ADMIN_HOST_LOOKUP'
                    && /Server "Nope" not found on the Admin Server at http:\/\/localhost:5895/.test(e.message)
                    && /Admin Server lists: 24retail, TM1_Test_DEV\./.test(e.message),
            )
        } finally {
            cfg.adminHosts[0].servers = ['DEV']
        }
    })
})

test('the sign-in route reports the setup error once and never returns the password', async () => {
    const handlers = {}
    const app = {
        post: (route, ...fns) => { handlers[route] = fns[fns.length - 1] },
        get: () => {}, delete: () => {},
    }
    const { register } = require('../routes/auth')
    register(app, {
        LOGIN_REQUIRED: true,
        PAW_HOST: null,
        SAMPLE_PASSWORD_WARNING: '',
        attachPawSession: async () => {},
        cl: { writeLog() {} },
        clearServerCredentials: () => {},
        closeServerSession: async () => {},
        createDirectSession: async () => 'token',
        createLocalSession: async () => 'token',
        createSaveDataAllRoute: () => () => {},
        createSession: async () => 'token',
        fail: () => {},
        gateReadOnly: () => true,
        getCSRF: async () => '',
        getCachedPawSession: async () => null,
        getLoginServer: () => '24retail',
        getServerCredentials: () => null,
        getServerStatus: () => 'ok',
        getSessionCredentials: () => ({ username: 'admin', password: 'Secret123!' }),
        invalidateSession: () => {},
        isAdminGroups: () => false,
        isDirectServer: () => true,
        isLoopbackReq: () => true,
        isPawNativeServer: () => false,
        isSampleLogin: () => false,
        isTm1Admin: async () => false,
        listServerEntries: () => [],
        listServers: () => ['24retail'],
        listServersWithFlags: () => [],
        loginRateLimit: { clear() {} },
        makeClient: () => { throw new Error('not used') },
        makeClientWithCredentials: () => ({
            get: async () => {
                const e = new Error('The address in config/servers.json (http://localhost:52670) answered as a TM1 server, not the TM1 Admin Server. Set "url" to the Admin Server, usually port 5895 (HTTP) or 5898 (HTTPS).')
                e.code = 'ADMIN_HOST_LOOKUP'
                throw e
            },
        }),
        path,
        probeAuthMethod: async () => ({}),
        requireTm1Admin: async () => true,
        sendSetupError: () => {},
        setServerCredentials: () => {},
        setSimpleInModes: () => {},
        setupBlankAdmin: async () => ({ state: {} }),
        simpleSource: () => null,
    })

    const logged = []
    const realError = console.error
    console.error = (...args) => logged.push(args.join(' '))
    try {
        const res = {
            statusCode: 200,
            status(code) { this.statusCode = code; return this },
            json(body) { this.body = body; return this },
        }
        await handlers['/api/auth/server-login'](
            { ideToken: 't', body: { server: '24retail', username: 'admin', password: 'Secret123!' } },
            res,
        )
        assert.equal(res.statusCode, 502)
        assert.equal(res.body.code, 'ADMIN_HOST_LOOKUP')
        assert.match(res.body.error, /answered as a TM1 server, not the TM1 Admin Server/)
        assert.equal(JSON.stringify(res.body).includes('Secret123!'), false)
        assert.equal(logged.length, 1)
        assert.equal(logged[0].includes('Secret123!'), false)
        assert.match(logged[0], /ADMIN_HOST_LOOKUP/)
    } finally {
        console.error = realError
    }
})
