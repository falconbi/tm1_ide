'use strict'
const { test } = require('node:test')
const assert = require('node:assert/strict')
const path = require('path')
const fs = require('fs')
const os = require('os')
const resolve = rel => require.resolve(path.join(__dirname, '..', rel))

const secrets = require(resolve('core/git-secrets'))

test('tokenSource reports env, saved or none without the token', () => {
    assert.equal(secrets.tokenSource({ TM1_GIT_TOKEN: 'env-token' }, { TM1_GIT_TOKEN: 'saved-token' }), 'env')
    assert.equal(secrets.tokenSource({}, { TM1_GIT_TOKEN: 'saved-token' }), 'saved')
    assert.equal(secrets.tokenSource({}, {}), 'none')
})

test('a saved token without an env var is sourced as saved and can be replaced', () => {
    const old = process.env.TM1_GIT_TOKEN
    delete process.env.TM1_GIT_TOKEN
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'git-secrets-'))
    const file = path.join(dir, 'git-secrets.json')
    try {
        secrets.setToken('new-token-123', file)
        assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).TM1_GIT_TOKEN, 'new-token-123')
        assert.equal(process.env.TM1_GIT_TOKEN, undefined, 'saving must not seed the environment')
        assert.equal(secrets.getToken(file, {}), 'new-token-123')
        assert.equal(secrets.tokenSource({}, { TM1_GIT_TOKEN: 'new-token-123' }), 'saved')
    } finally {
        fs.rmSync(dir, { recursive: true, force: true })
        if (old !== undefined) process.env.TM1_GIT_TOKEN = old
    }
})

test('saving a token is refused while the environment supplies one', () => {
    const old = process.env.TM1_GIT_TOKEN
    process.env.TM1_GIT_TOKEN = 'env-token'
    try {
        assert.throws(() => secrets.setToken('new-token-123'), (e) => e.status === 409 && /wins over a saved token/.test(e.message))
    } finally {
        if (old === undefined) delete process.env.TM1_GIT_TOKEN
        else process.env.TM1_GIT_TOKEN = old
    }
})

function routeHarness({ client = null, tokenSource = 'env', token = 'super-secret-token' } = {}) {
    const { register } = require(resolve('routes/deploy'))
    const handlers = {}
    const app = { get(p, fn) { handlers[p] = fn }, post(p, fn) { handlers[p] = fn } }
    const gitSecrets = {
        tokenSource: () => tokenSource,
        setToken: () => { throw Object.assign(new Error('env wins'), { status: 409 }) },
    }
    register(app, {
        _GI: () => ({ user: () => 'u' }), _GITOK: () => token,
        makeClient: () => client ?? { post: async () => ({ URL: 'https://github.com/x/y.git', Deployment: 'DEV', Remote: { Connected: true } }) },
        gitSecrets, fail: (res, e) => res.status(500).json({ error: e.message }),
    })
    return { handlers, gitSecrets }
}
function response() {
    return { statusCode: 200, body: null, status(c) { this.statusCode = c; return this }, json(b) { this.body = b; return this } }
}

test('status reports tokenSource and never the token', async () => {
    const { handlers } = routeHarness({ tokenSource: 'saved' })
    const res = response()
    await handlers['/api/git/setup/status']({ query: { server: 'S' }, ideToken: 't' }, res)
    assert.equal(res.body.tokenSource, 'saved')
    assert.equal(res.body.linked, true)
    assert.doesNotMatch(JSON.stringify(res.body), /super-secret-token/)
})

test('status reports the remote branches and this server attrs branch', async () => {
    const client = {
        post: async () => ({
            URL: 'https://github.com/x/y.git', Deployment: 'DEV', Remote: { Connected: true, Branches: ['dev', 'attrs-D1'] },
        }),
    }
    const { handlers } = routeHarness({ client })
    const res = response()
    await handlers['/api/git/setup/status']({ query: { server: 'D1' }, ideToken: 't' }, res)
    assert.deepEqual(res.body.branches, ['dev', 'attrs-D1'])
    assert.equal(res.body.attrsBranch, 'attrs-D1')
})

test('status failure carries TM1 message, token hint and tokenSource', async () => {
    const { handlers } = routeHarness({ client: { post: async () => { throw new Error('Authentication failed') } }, tokenSource: 'env' })
    const res = response()
    await handlers['/api/git/setup/status']({ query: { server: 'S' }, ideToken: 't' }, res)
    assert.equal(res.statusCode, 502)
    assert.match(res.body.error, /Authentication failed/)
    assert.match(res.body.error, /token may have expired/)
    assert.equal(res.body.tokenSource, 'env')
})

test('token save refusal keeps the 409 and never echoes the token', () => {
    const { handlers } = routeHarness()
    const res = response()
    handlers['/api/git/setup/token']({ body: { token: 'super-secret-token' } }, res)
    assert.equal(res.statusCode, 409)
    assert.doesNotMatch(JSON.stringify(res.body), /super-secret-token/)
})
