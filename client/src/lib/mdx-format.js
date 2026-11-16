// One MDX formatter for the IDE. 'statement' lays out a SELECT/ON/FROM/WHERE
// query; 'set' lays out a set expression's braces and commas.

function formatStatement(mdx) {
  if (!mdx?.trim()) return mdx
  let s = mdx.replace(/\s+/g, ' ').trim()
  s = s
    .replace(/\bSELECT\b\s*/gi,               'SELECT\n  ')
    .replace(/\s*\bNON EMPTY\b\s*/gi,          ' NON EMPTY ')
    .replace(/\s*\bON COLUMNS\s*,\s*/gi,       ' ON COLUMNS,\n  ')
    .replace(/\s*\bON COLUMNS\b/gi,            ' ON COLUMNS')
    .replace(/\s*\bON ROWS\s*,\s*/gi,          ' ON ROWS,\n  ')
    .replace(/\s*\bON ROWS\b/gi,               ' ON ROWS')
    .replace(/\s*\bON 0\s*,\s*/gi,             ' ON COLUMNS,\n  ')
    .replace(/\s*\bON 0\b/gi,                  ' ON COLUMNS')
    .replace(/\s*\bON 1\s*,\s*/gi,             ' ON ROWS,\n  ')
    .replace(/\s*\bON 1\b/gi,                  ' ON ROWS')
    .replace(/\s*\bFROM\b\s*/gi,               '\nFROM ')
    .replace(/\s*\bWHERE\b\s*/gi,              '\nWHERE ')
    .trim()
  return s.split('\n').map(line => {
    const lead = line.match(/^(\s*)/)[1]
    const body = line.trimStart()
    if (!body.includes('{')) return line
    let out = '', depth = 0
    for (let i = 0; i < body.length; i++) {
      const ch = body[i]
      if      (ch === '{') { out += '{\n' + lead + '  '.repeat(depth + 1); depth++ }
      else if (ch === '}') { depth = Math.max(0, depth - 1); out = out.trimEnd() + '\n' + lead + '  '.repeat(depth) + '}' }
      else if (ch === ',' && depth > 0) { out += ',\n' + lead + '  '.repeat(depth) }
      else { out += ch }
    }
    return lead + out.trim()
  }).join('\n').trim()
}

function formatSet(mdx) {
  if (!mdx?.trim()) return mdx
  let out = '', depth = 0, i = 0
  const pad = (n) => '  '.repeat(Math.max(0, n))
  while (i < mdx.length) {
    const ch = mdx[i]
    if (ch === '{') { out += '{\n' + pad(depth + 1); depth++ }
    else if (ch === '}') { depth--; out = out.trimEnd() + '\n' + pad(depth) + '}' }
    else if (ch === ',' && depth > 0) { out += ',\n' + pad(depth) }
    else if (ch === '\n') { /* collapse existing newlines */ out += ' ' }
    else { out += ch }
    i++
  }
  return out.trim()
}

export function formatMDX(mdx, { mode = 'statement' } = {}) {
  return mode === 'set' ? formatSet(mdx) : formatStatement(mdx)
}
