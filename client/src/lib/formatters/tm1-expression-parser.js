// ── TM1 Expression Parser ─────────────────────────────────────────────────────
// Recursive descent parser for TM1 rule RHS expressions.

class TokenStream {
  constructor(tokens) { this.tokens = tokens; this.pos = 0 }
  peek(offset = 0)  { return this.tokens[this.pos + offset] ?? null }
  consume()         { return this.tokens[this.pos++] ?? null }
  done()            { return this.pos >= this.tokens.length }
}

function isCall(stream) {
  const t0 = stream.peek(0)
  const t1 = stream.peek(1)
  return (t0?.type === 'identifier' || t0?.type === 'keyword') &&
         t1?.type === 'punctuation' && t1.value === '('
}

function parseArgs(stream) {
  const args = []
  while (!stream.done()) {
    if (stream.peek()?.type === 'punctuation' && stream.peek().value === ')') break
    args.push(parseExpr(stream))
    if (stream.peek()?.type === 'punctuation' && stream.peek().value === ',') stream.consume()
  }
  if (stream.peek()?.type === 'punctuation' && stream.peek().value === ')') stream.consume()
  return args
}

function parsePrimary(stream) {
  if (stream.done()) return { kind: 'empty' }
  const t = stream.peek()

  if (isCall(stream)) {
    const name = stream.consume()
    stream.consume() // '('
    const args = parseArgs(stream)
    return { kind: 'call', name: name.value, nameToken: name, args }
  }

  // Element reference: ['...']
  if (t.type === 'punctuation' && t.value === '[') {
    const parts = [stream.consume()]
    while (!stream.done() && stream.peek()?.value !== ']') parts.push(stream.consume())
    if (stream.peek()?.value === ']') parts.push(stream.consume())
    return { kind: 'element_ref', value: parts.map(p => p.value).join('') }
  }

  // Parenthesised sub-expression
  if (t.type === 'punctuation' && t.value === '(') {
    stream.consume()
    const inner = parseExpr(stream)
    if (stream.peek()?.value === ')') stream.consume()
    return inner
  }

  // Unary minus
  if (t.type === 'operator' && t.value === '-') {
    stream.consume()
    return { kind: 'unary', op: '-', operand: parsePrimary(stream) }
  }

  // Atom
  return { kind: 'atom', token: stream.consume() }
}

function parseExpr(stream) {
  let left = parsePrimary(stream)
  while (!stream.done()) {
    const t = stream.peek()

    if (t?.type === 'operator') {
      const op = stream.consume()
      const right = parsePrimary(stream)
      left = { kind: 'binary', op: op.value, left, right }
      continue
    }

    // Handle @= — tokeniser emits '@' as unknown, '=' as operator
    if (t?.type === 'unknown') {
      const op = stream.consume()
      const next = stream.peek()
      if (next?.type === 'operator' && next.value === '=') {
        stream.consume()
        const right = parsePrimary(stream)
        left = { kind: 'binary', op: op.value + '=', left, right }
        continue
      }
    }

    break
  }
  return left
}

export function parseExpression(tokens) {
  const stream = new TokenStream(tokens.filter(t => t.type !== 'whitespace'))
  return parseExpr(stream)
}
