'use strict'
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { JSDOM } = require('jsdom')

const KIT = fs.readFileSync(path.join(__dirname, '..', 'static', 'lens-kit', 'lens-kit.js'), 'utf8')
const plain = v => JSON.parse(JSON.stringify(v))
const until = async (fn, what, ms = 3000) => {
  const t0 = Date.now()
  for (;;) {
    const v = fn()
    if (v) return v
    if (Date.now() - t0 > ms) throw new Error('timed out waiting for ' + what)
    await new Promise(r => setTimeout(r, 20))
  }
}

// A tiny stack is a real ECharts chart: its option is what the toolkit drew.
test('Lens.stack: stacked components, compare line, red tops, legend toggle and clicks', async () => {
  const dom = new JSDOM('<!doctype html><html><body><div id="chart" style="width:520px;height:260px"></div></body></html>', {
    runScripts: 'dangerously', pretendToBeVisual: true,
    beforeParse(win) {
      win.__lensTheme = null
      win.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} }
      win.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} })
      const ctx = new Proxy({}, { get: (o, k) => k === 'measureText' ? (t => ({ width: String(t).length * 6 })) : k === 'getImageData' ? (() => ({ data: [] })) : (() => {}) })
      win.HTMLCanvasElement.prototype.getContext = () => ctx
      win.console.warn = () => {}
    },
  })
  const w = dom.window, d = w.document
  try {
    const script = d.createElement('script')
    script.textContent = KIT
    d.body.appendChild(script)
    await until(() => w.Lens && typeof w.Lens.stack === 'function', 'the toolkit')

    const clicks = []
    const c = w.Lens.stack('#chart', {
      categories: ['Jan', 'Feb'],
      series: [{ name: 'Base', values: [10000, 20000] }, { name: 'Tax', values: [2000, 4000] }],
      compare: [5000, 30000], format: '£k', cost: true,
      onClick: (name, source) => clicks.push([name, source]),
    })
    const o = c.getOption(), bars = o.series.filter(s => s.type === 'bar'), cmp = o.series.find(s => s.type === 'line')
    assert.deepEqual(plain(o.xAxis[0].data), ['Jan', 'Feb'])
    assert.deepEqual(plain(bars.map(s => [s.name, s.stack])), [['Base', 'total'], ['Tax', 'total']])
    assert.deepEqual(plain(o.legend[0].data), ['Base', 'Tax'])
    assert.deepEqual(plain(cmp.data), [5000, 30000])
    assert.notEqual(bars[0].data[0].itemStyle.color, bars[1].data[0].itemStyle.color, 'components have distinct shades')
    assert.equal(bars[1].data[0].itemStyle.color, w.Lens.theme.colors.bad, 'Jan is over: the top of the stack is red')
    assert.notEqual(bars[1].data[1].itemStyle.color, w.Lens.theme.colors.bad, 'Feb is under: no red')

    const tip = o.tooltip[0].formatter([
      { seriesType: 'bar', seriesName: 'Base', value: 10000, dataIndex: 0, marker: 'A' },
      { seriesType: 'bar', seriesName: 'Tax', value: 2000, dataIndex: 0, marker: 'B' },
    ])
    assert.match(tip, /Base/); assert.match(tip, /Tax/); assert.match(tip, /£12k/); assert.match(tip, /vs comparison/); assert.match(tip, /£5k/)

    c.trigger('click', { seriesType: 'bar', seriesName: 'Base' })
    assert.deepEqual(clicks.at(-1), ['Base', 'bar'])

    c.dispatchAction({ type: 'legendToggleSelect', name: 'Tax' })
    await until(() => c.getOption().legend[0].selected.Tax === false, 'the legend to hide Tax')
    const after = c.getOption()
    assert.equal(after.series[0].data[0].itemStyle.color, w.Lens.theme.colors.bad, 'Base alone is now over: the new top is red')
    assert.deepEqual(clicks.at(-1), ['Tax', 'legend'])
  } finally { dom.window.close() }
})
