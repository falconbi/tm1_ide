import { test } from 'node:test'
import assert from 'node:assert/strict'
import { pushStep, backTo, previousStep } from '../client/src/lib/cubemap-trail.js'

const cube = id => ({ kind: 'node', id })
const proc = name => ({ kind: 'node', id: `proc:${name}` })

test('each drill adds a step, and Back walks them all the way to the start', () => {
  let t = [cube('WFP Workforce Cost')]                 // arrived from the Rules editor
  t = pushStep(t, proc('Tax Run Post'))
  t = pushStep(t, cube('WFP Assignment Base'))
  assert.equal(t.length, 3)
  assert.deepEqual(previousStep(t), proc('Tax Run Post'))
  t = backTo(t, t.length - 2)
  assert.deepEqual(previousStep(t), cube('WFP Workforce Cost'))
  t = backTo(t, t.length - 2)
  assert.deepEqual(t, [cube('WFP Workforce Cost')])
  assert.equal(previousStep(t), null)                  // one more Back → the full map
})

test('revisiting a cube adds it again — earlier steps are kept', () => {
  // Workforce Cost → Tax Run Post → back into Workforce Cost (the process writes it)
  let t = [cube('WFP Workforce Cost')]
  t = pushStep(t, proc('Tax Run Post'))
  t = pushStep(t, cube('WFP Workforce Cost'))
  assert.equal(t.length, 3)
  assert.deepEqual(previousStep(t), proc('Tax Run Post'))
})

test('clicking the current step again (a double-click) adds nothing', () => {
  const t = pushStep(pushStep([], cube('A')), cube('A'))
  assert.deepEqual(t, [cube('A')])
})

test('jumping to an earlier step drops the later ones', () => {
  const t = [cube('A'), proc('P'), cube('B'), cube('C')]
  assert.deepEqual(backTo(t, 1), [cube('A'), proc('P')])
  assert.deepEqual(backTo(t, 9), t)                    // out of range — unchanged
})
