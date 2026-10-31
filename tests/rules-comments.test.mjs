import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseLogicalUnits } from '../client/src/lib/formatters/tm1-structured.js'
import { tokenize } from '../client/src/lib/formatters/tokenizer.js'
import { findUnclosedStringLine, stripComments } from '../client/src/lib/rules-comments.js'

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

test('an unclosed string is reported on the line where it opened, not a later quote', () => {
  const code = [
    'SKIPCHECK;',
    '',
    '# comment',
    '',
    "[] = N:IF(ELPAR('WFP Version', !WFP Version, 1) @= 'Non-Calculating',STET,CONTINUE);",
    '',
    "['Act vs Bud'] = N:",
    "  IF(ATTRN('WFP Period', !WFP Period, 'Actuals Closed') = 1, 1, 0);",
  ].join('\n').replace("ELPAR('WFP Version'", "ELPAR(WFP Version'")

  assert.equal(findUnclosedStringLine(code), 5)
})

test('apostrophes in comments are not treated as strings', () => {
  const code = "# the people's FTE\n['x'] = 'ok';\n"
  assert.equal(findUnclosedStringLine(code), 0)
})
