// A handful of records from an ASCII file, as the process will receive them.
// `headerRecords` is the number of leading lines that name the columns; zero
// means the file has no header, so the columns are numbered instead.
export function parseAsciiPreview(text, { delimiter = ',', headerRecords = 1 } = {}) {
  const lines = String(text ?? '').split(/\r?\n/).filter(l => l !== '')
  const delim = delimiter || ','
  const head = Number(headerRecords ?? 1) || 0
  const split = l => l.split(delim)
  const body = lines.slice(head)
  const width = Math.max(1, ...body.slice(0, 20).map(l => split(l).length))
  const columns = head > 0 && lines.length > 0
    ? split(lines[0])
    : Array.from({ length: width }, (_, i) => `Column ${i + 1}`)
  return { columns, rows: body.slice(0, 20).map(split), rowCount: body.length, note: 'first 20 records' }
}

// `request()` already throws on a non-2xx answer, so the old `if (!r.ok)` branch
// never ran. A v11 server answers with a bare 404/500; show the actionable v12
// message for those, and the server's own text only when it says something real.
export function asciiFileReadMessage(file, error) {
  const message = String(error?.message ?? error ?? '').trim()
  const generic = !message || /^\d{3}\b/.test(message) || /^http\s+\d{3}/i.test(message) ||
    /^(not found|internal server error|bad gateway|service unavailable|gateway timeout|method not allowed|unsupported media type|not implemented|failed to fetch|network error|loading failed)$/i.test(message)
  if (!generic) return message
  return `Could not read ${file}. Reading server files needs Planning Analytics v12; on v11 TM1 has no way to read them over its API.`
}
