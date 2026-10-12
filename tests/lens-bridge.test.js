'use strict'
const { test, afterEach } = require('node:test')
const assert = require('node:assert/strict')
const { LENS_BRIDGE_SCRIPT, installLensHost, lensSrcDoc } = require('../shared/lens-bridge')

// Offline host tests: simulate a window + frame + fetch. The bridge script itself
// only runs in a browser (srcdoc); here we check it is generated with the channel
// guard, and that the host logic answers only its own frame and never lets the
// message choose the server.

const _window = global.window
const _localStorage = global.localStorage
const _fetch = global.fetch

const flush = () => new Promise(r => setTimeout(r, 0))

function fakeDom({ source, respond }) {
  const listeners = {}
  const win = {
    addEventListener: (type, fn) => { (listeners[type] ??= []).push(fn) },
    removeEventListener: (type, fn) => { listeners[type] = (listeners[type] ?? []).filter(x => x !== fn) },
    _listeners: listeners,
    _source: source,                    // the exact iframe contentWindow the host answers
    _posted: [],
    _nopost: [],
    contentWindow: {
      postMessage: (msg) => { win._posted.push(msg) },
    },
    postMessage: (msg) => { win._nopost.push(msg) },  // anything we post from "the other side"
    _emit(type, ev) { for (const fn of listeners[type] ?? []) fn(ev) },
  }
  return win
}

afterEach(() => {
  global.window = global.localStorage = undefined
  global.fetch = _fetch
  if (_window !== undefined) global.window = _window
  if (_localStorage !== undefined) global.localStorage = _localStorage
})

test('LENS_BRIDGE_SCRIPT is the per-page-channel bridge with the frame guard', () => {
  assert.equal(typeof LENS_BRIDGE_SCRIPT, 'string')
  assert.match(LENS_BRIDGE_SCRIPT, /window\.lensBridge\s*=\s*\{/)
  assert.match(LENS_BRIDGE_SCRIPT, /__fbInstalled/, 'installs once per page')
  assert.match(LENS_BRIDGE_SCRIPT, /var chan =/, 'a private channel per page (aa3783f fix)')
  assert.match(LENS_BRIDGE_SCRIPT, /chan !== chan/, 'replies only on this page\u2019s channel')
})

test('lensSrcDoc prepends the bridge script to a Lens html', () => {
  const out = lensSrcDoc('<div>hi</div>')
  assert.ok(out.startsWith('<script>'))
  assert.ok(out.includes(LENS_BRIDGE_SCRIPT))
  assert.ok(out.endsWith('<div>hi</div>'))
})

test('the host answers only its exact frame and posts back on the same channel', async () => {
  const calls = []
  const win = fakeDom({ source: {} })
  const me = { ...win.contentWindow }; me.postMessage = (m) => win._posted.push(m)

  global.window = win
  global.localStorage = { getItem: () => null, setItem: () => {} }
  global.fetch = async (url, init) => {
    calls.push([String(url), init?.method])
    return { ok: true, json: async () => ({ value: 'ok' }), statusText: 'OK' }
  }

  const off = installLensHost(() => me, { getServer: () => '24Retail', getToken: () => 'ABCD' })
  try {
    // From a DIFFERENT source: ignored — no fetch, no reply.
    win._emit('message', { data: { __lensBridge: 1, id: 1, chan: 'x', method: 'execMDX', payload: { mdx: 'S' } }, source: { other: true } })
    await flush()
    assert.equal(calls.length, 0, 'a message not from the exact frame is ignored')

    // From the exact frame: answered, URL carries the server from settings.
    const msg = { __lensBridge: 1, id: 2, chan: 'abc', method: 'getMeta', payload: { cube: 'Cube1' } }
    win._emit('message', { data: msg, source: me })
    await flush()
    assert.equal(calls.length, 1)
    assert.match(calls[0][0], /\/api\/lens\/meta\?server=24Retail&cube=Cube1$/)
    assert.equal(calls[0][1], 'GET')
    assert.equal(win._posted[0].id, 2, 'replies to the same id')
    assert.equal(win._posted[0].chan, 'abc', 'on the frame\u2019s channel')
    assert.deepEqual(win._posted[0].result, { value: 'ok' })
  } finally { off() }
})

test('the server always comes from settings, never from the message', async () => {
  const calls = []
  const win = fakeDom({ source: {} })
  const me = { ...win.contentWindow }; me.postMessage = (m) => win._posted.push(m)
  global.window = win
  global.localStorage = { getItem: () => null, setItem: () => {} }
  global.fetch = async (url, init) => {
    calls.push(String(url))
    return { ok: true, json: async () => ({ value: 'ok' }), statusText: 'OK' }
  }
  const off = installLensHost(() => me, { getServer: () => '24Retail', getToken: () => '' })
  try {
    // A hostile message puts another server every place it can — none of it is used.
    const msg = { __lensBridge: 1, id: 3, chan: 'c', method: 'readCell', payload: { server: 'H4x0r', cube: 'C', coordinates: { D: 'E' } } }
    win._emit('message', { data: msg, source: me })
    await flush()
    assert.equal(calls.length, 1)
    assert.match(calls[0], /\/api\/lens\/read-cell\?server=24Retail$/)
    assert.ok(!calls[0].includes('H4x0r'), 'message-provided server never used')
  } finally { off() }
})