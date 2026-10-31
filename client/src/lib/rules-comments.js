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

// Return the line where a single-line rule string is left open, or 0 if all
// strings close. Comments are ignored, including apostrophes inside them.
// If a quote is removed early, later quotes may look paired; reporting the
// first line that ends while a string is open points at the real mistake.
export function findUnclosedStringLine(code) {
  let inStr = false
  let inComment = false
  let line = 1
  let startLine = 1
  for (let i = 0; i < code.length; i++) {
    const ch = code[i]
    if (inComment) {
      if (ch === '\n') { inComment = false; line++ }
      continue
    }
    if (ch === '#') { inComment = true; continue }
    if (ch === '\n') {
      if (inStr) return startLine
      line++
      continue
    }
    if (ch === "'") {
      if (inStr && i + 1 < code.length && code[i + 1] === "'") { i++; continue }
      inStr = !inStr
      if (inStr) startLine = line
    }
  }
  return inStr ? startLine : 0
}
