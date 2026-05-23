// ── TM1 Rules Tokenizer ─────────────────────────────────────────────────────
// Character-by-character tokenizer for reliable parsing of TM1 rule syntax.
// Handles strings, dimension variables, operators, area prefixes, directives, etc.

const DIRECTIVES = new Set(['#region', '#endregion'])
const AREA_PREFIXES = new Set(['n:', 'c:', 's:'])
const KEYWORDS = new Set([
  'if', 'elseif', 'else', 'endif', 'continue', 'stet',
  'feeders', 'skipcheck',
])

const MULTI_CHAR_OPS = ['<>', '>=', '<=', '=>']
const SINGLE_CHAR_OPS = new Set(['=', '+', '-', '*', '/', '%', '&', '|', '<', '>'])
const PUNCTUATION = new Set(['(', ')', '[', ']', '{', '}', ',', ';'])

/**
 * Tokenize a single line of TM1 rules.
 * @param {string} line
 * @returns {Array<{type:string, value:string, raw:string, pos:number}>}
 */
export function tokenize(line) {
  const tokens = []
  let i = 0
  const len = line.length

  const peek = (n = 1) => line.slice(i, i + n)
  const advance = (n = 1) => { i += n }

  while (i < len) {
    const ch = line[i]
    const start = i

    // Whitespace
    if (/\s/.test(ch)) {
      let val = ''
      while (i < len && /\s/.test(line[i])) {
        val += line[i]
        i++
      }
      tokens.push({ type: 'whitespace', value: val, raw: val, pos: start })
      continue
    }

    // Comment: // ...
    if (ch === '/' && peek(2) === '//') {
      const val = line.slice(i)
      tokens.push({ type: 'comment', value: val, raw: val, pos: start })
      break
    }

    // Comment or directive: # ...
    if (ch === '#') {
      const rest = line.slice(i).toLowerCase()
      const isDirective = DIRECTIVES.has(rest.split(/\s/)[0])
      if (isDirective) {
        const val = line.slice(i)
        tokens.push({ type: 'directive', value: val, raw: val, pos: start })
      } else {
        const val = line.slice(i)
        tokens.push({ type: 'comment', value: val, raw: val, pos: start })
      }
      break
    }

    // String literal: '...'
    if (ch === "'") {
      let val = "'"
      i++
      while (i < len) {
        if (line[i] === "'") {
          val += "'"
          i++
          break
        }
        val += line[i]
        i++
      }
      tokens.push({ type: 'string', value: val, raw: val, pos: start })
      continue
    }

    // Dimension variable: !identifier
    // Dimension names may contain spaces (e.g. !GBL Year), so continue
    // greedily past a space when the next char is still a word character.
    if (ch === '!') {
      let val = '!'
      i++
      while (i < len && /[a-zA-Z0-9_]/.test(line[i])) { val += line[i++] }
      while (i < len && line[i] === ' ' && i + 1 < len && /[a-zA-Z0-9_]/.test(line[i + 1])) {
        val += line[i++]
        while (i < len && /[a-zA-Z0-9_]/.test(line[i])) { val += line[i++] }
      }
      tokens.push({ type: 'dim_var', value: val, raw: val, pos: start })
      continue
    }

    // Number
    if (/\d/.test(ch)) {
      let val = ''
      while (i < len && (/\d/.test(line[i]) || line[i] === '.' || line[i] === 'e' || line[i] === 'E' || line[i] === '-' || line[i] === '+')) {
        val += line[i]
        i++
      }
      tokens.push({ type: 'number', value: val, raw: val, pos: start })
      continue
    }

    // Multi-char operators (check before single-char)
    const two = peek(2)
    if (MULTI_CHAR_OPS.includes(two)) {
      tokens.push({ type: 'operator', value: two, raw: two, pos: start })
      advance(2)
      continue
    }

    // Single-char operators
    if (SINGLE_CHAR_OPS.has(ch)) {
      tokens.push({ type: 'operator', value: ch, raw: ch, pos: start })
      advance()
      continue
    }

    // Punctuation
    if (PUNCTUATION.has(ch)) {
      tokens.push({ type: 'punctuation', value: ch, raw: ch, pos: start })
      advance()
      continue
    }

    // Identifier (or keyword, or area prefix)
    if (/[a-zA-Z_]/.test(ch)) {
      let val = ''
      while (i < len && /[a-zA-Z0-9_]/.test(line[i])) {
        val += line[i]
        i++
      }
      // Check if next char is ':' making it an area prefix
      if (i < len && line[i] === ':' && AREA_PREFIXES.has(val.toLowerCase() + ':')) {
        const prefixVal = val + ':'
        tokens.push({ type: 'area_prefix', value: prefixVal, raw: prefixVal, pos: start })
        advance() // consume ':'
        continue
      }
      const lower = val.toLowerCase()
      if (KEYWORDS.has(lower)) {
        tokens.push({ type: 'keyword', value: val, raw: val, pos: start })
      } else {
        tokens.push({ type: 'identifier', value: val, raw: val, pos: start })
      }
      continue
    }

    // Unknown character — consume and move on
    tokens.push({ type: 'unknown', value: ch, raw: ch, pos: start })
    advance()
  }

  return tokens
}
