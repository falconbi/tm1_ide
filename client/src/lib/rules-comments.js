// A rule statement can span several physical lines and contain a comment line
// inside a function call. Strip comments before tokenizing so an apostrophe in
// a comment ("the people's FTE") cannot be read as a string quote, and so a
// trailing ; after a comment is still seen. Strings are preserved.
export function stripComments(text) {
  let out = ''
  let inStr = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (ch === "'") {
      if (inStr && text[i + 1] === "'") { out += "''"; i++; continue }
      inStr = !inStr
      out += ch
      continue
    }
    if (!inStr && ch === '#') {
      while (i < text.length && text[i] !== '\n') i++
      if (i < text.length) out += '\n'
      continue
    }
    if (!inStr && ch === '/' && text[i + 1] === '/') {
      while (i < text.length && text[i] !== '\n') i++
      if (i < text.length) out += '\n'
      continue
    }
    out += ch
  }
  return out
}
