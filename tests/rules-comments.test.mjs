import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseLogicalUnits } from '../client/src/lib/formatters/tm1-structured.js'
import { tokenize } from '../client/src/lib/formatters/tokenizer.js'
import { stripComments } from '../client/src/lib/rules-comments.js'

test('a comment inside a multi-line rule cannot hide the closing semicolon', () => {
  const source = `['Benefits'] = N:
  IF([X] = 0, 0,
    # the people's FTE
    * ['Y']);`

  const unit = parseLogicalUnits(source).find(u => u.type === 'statement')
  const tokens = tokenize(stripComments(unit.text)).filter(t => t.type !== 'whitespace')

  assert.equal(tokens.at(-1).value, ';')
})

test('stripComments keeps # and // inside strings', () => {
  assert.equal(stripComments("['x'] = 'a#b // c'; # trailing"), "['x'] = 'a#b // c'; ")
})

test('stripComments removes full-line and inline comments but preserves newlines', () => {
  const source = "# first\n['x'] = 1; # inline\n// another\n['y'] = 2;"
  assert.equal(stripComments(source), "\n['x'] = 1; \n\n['y'] = 2;")
})
