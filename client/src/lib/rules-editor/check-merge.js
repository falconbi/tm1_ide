// Merge TM1 CheckRules errors with the static findings for the issues list.
// Once TM1 reports a syntax error, static warnings later in the file are usually
// cascades from it (the parser has lost sync), so keep only static findings
// before the first TM1 error. A non-numeric LineNumber counts as line 0, as it
// always has — TM1's own message is still shown.
export function mergeCheckErrors(staticErrors, tm1Errors) {
  const firstTm1Line = tm1Errors.length
    ? Math.min(...tm1Errors.map(e => Number(e.LineNumber) || 0))
    : null
  const staticToShow = firstTm1Line === null
    ? staticErrors
    : staticErrors.filter(e => e.line < firstTm1Line)
  return {
    firstTm1Line,
    staticToShow,
    errors: [
      ...tm1Errors.map(e => ({ severity: 'error', line: e.LineNumber, message: e.Message })),
      ...staticToShow.map(e => ({ severity: e.severity ?? 'error', line: e.line, message: e.message })),
    ],
  }
}
