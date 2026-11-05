// Double-click inside a quoted TM1 name ('LAB Employee') selects the whole name between the quotes,
// not just the word under the mouse. Outside quotes, and in # comment lines, Monaco's own
// double-click is left alone. Double-click on a quote mark itself selects the name WITH its quotes.
// TM1 strings are single-quoted; '' inside one is an escaped quote.

// charColumn: 1-based column of the character under the mouse
export function quotedRangeAt(line, charColumn) {
  if (line.trimStart().startsWith('#')) return null
  const idx = charColumn - 1
  let i = 0
  while (i < line.length) {
    if (line[i] !== "'") { i++; continue }
    let j = i + 1
    while (j < line.length) {
      if (line[j] === "'" && line[j + 1] === "'") { j += 2; continue }
      if (line[j] === "'") break
      j++
    }
    if (j >= line.length) return null          // unclosed quote
    if (idx === i || idx === j) return { startColumn: i + 1, endColumn: j + 2 }   // on a quote: with quotes
    if (idx > i && idx < j) return { startColumn: i + 2, endColumn: j + 1 }       // inside: the name only
    i = j + 1
  }
  return null
}

export function enableQuoteDoubleClick(editor) {
  return editor.onMouseDown(e => {
    if (e.event.detail !== 2 || !e.target.position) return
    const { lineNumber, column } = e.target.position
    // mouseColumn is the character under the pointer; position.column is the nearest caret gap
    const range = quotedRangeAt(editor.getModel().getLineContent(lineNumber), e.target.mouseColumn ?? column)
    if (!range) return
    // after Monaco has applied its own word selection for this click
    setTimeout(() => editor.setSelection({ startLineNumber: lineNumber, endLineNumber: lineNumber, ...range }), 0)
  })
}
