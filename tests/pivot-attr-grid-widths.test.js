'use strict'
// Attribute-grid column widths — the rule the Dimension Editor's AttrGrid relies
// on. AG Grid owns a column's live width. If a render re-applies columnDefs with
// a `width`, the grid treats that as an instruction to resize the column, so a
// drag that is in progress snaps back to the value captured in React state. The
// editor therefore keeps saved widths out of columnDefs and hands them to the
// grid once, via initialState.columnSizing, then only records finished resizes.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { JSDOM } = require('jsdom')

const AG = require('../client/node_modules/ag-grid-community')
AG.ModuleRegistry.registerModules([AG.AllCommunityModule])

function grid(initialState) {
  const dom = new JSDOM('<!doctype html><div id="g" style="height:400px;width:1000px"></div>', {
    pretendToBeVisual: true,
  })
  const { window } = dom
  const saved = {}
  for (const key of ['window', 'document', 'navigator', 'location', 'history', 'getComputedStyle',
    'Node', 'Element', 'HTMLElement', 'Event', 'MouseEvent', 'KeyboardEvent', 'CustomEvent',
    'DOMParser', 'MutationObserver', 'requestAnimationFrame', 'cancelAnimationFrame', 'DocumentFragment']) {
    // defineProperty, not assignment: Node 21+ has a getter-only global navigator
    saved[key] = Object.getOwnPropertyDescriptor(global, key)
    Object.defineProperty(global, key, {
      value: key === 'window' ? window : key === 'document' ? window.document : window[key],
      configurable: true, writable: true,
    })
  }
  window.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} }
  window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} })

  const api = AG.createGrid(window.document.getElementById('g'), {
    columnDefs: [
      { field: '__name', headerName: 'Element', pinned: 'left', initialWidth: 220 },
      { field: 'Description', headerName: 'Description', initialWidth: 480, minWidth: 80 },
      { field: 'Format', headerName: 'Format', initialWidth: 170, minWidth: 80 },
    ],
    rowData: [{ __name: 'Total Year', Description: 'All year', Format: '' }],
    initialState,
  })

  return {
    api,
    width: id => api.getColumn(id).getActualWidth(),
    // what a React render does: hand the grid a brand-new columnDefs array
    setDefs(width) {
      const describe = w => (w == null ? { initialWidth: 480 } : { width: w })
      api.setGridOption('columnDefs', [
        { field: '__name', headerName: 'Element', pinned: 'left', initialWidth: 220 },
        { field: 'Description', headerName: 'Description', minWidth: 80, ...describe(width) },
        { field: 'Format', headerName: 'Format', initialWidth: 170, minWidth: 80 },
      ])
    },
    close() {
      api.destroy()
      dom.window.close()
      for (const [key, desc] of Object.entries(saved)) {
        if (desc) Object.defineProperty(global, key, desc)
        else delete global[key]
      }
    },
  }
}

test('re-applying a colDef width mid-drag snaps the column back to the colDef value', () => {
  const g = grid()
  try {
    g.api.getColumn('Description').setActualWidth(600, 'uiColumnResized', true)
    assert.equal(g.width('Description'), 600)

    // A re-render during the drag re-applies the last saved width (480).
    g.setDefs(480)
    assert.equal(g.width('Description'), 480, 'width in a colDef overrides the in-progress drag')
  } finally { g.close() }
})

test('saved widths come from grid state and survive later columnDefs updates', () => {
  const g = grid({ columnSizing: { columnSizingModel: [{ colId: 'Description', width: 650 }] } })
  try {
    assert.equal(g.width('Description'), 650, 'initialState.columnSizing wins over initialWidth')

    g.api.getColumn('Description').setActualWidth(600, 'uiColumnResized', true)
    // A re-render that only sets initialWidth leaves the live width alone.
    g.setDefs(null)
    assert.equal(g.width('Description'), 600, 'initialWidth must not resize an existing column')
  } finally { g.close() }
})
