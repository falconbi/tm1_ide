'use strict'

// Shared OData segment / URI-reference encoder (see docs/ESCAPING_AUDIT.md).
// TM1 REST keys sit inside single quotes in a URL path (`Dimensions('Name')`),
// so a literal apostrophe in a name must be doubled (`''`) for the OData key
// literal — and encodeURIComponent deliberately leaves `'` alone, so that
// doubling reaches the server as `''` (percent-encoding it to %27 would
// re-introduce a naked apostrophe inside the quoted key and break parsing).
// Everything else in the segment — `% # ? & + space` — is then percent-encoded,
// so a name like `Test's #1 %` becomes `Test''s%20%231%20%25`, one safe segment.
const odataKey = (name) => encodeURIComponent(String(name).replace(/'/g, "''"))

// A name/value embedded in a $filter STRING LITERAL (`$filter: CubeName eq 'x'`)
// needs '→'' doubling only; the transport must URL-encode the query param.
const odataLit = (value) => String(value).replace(/'/g, "''")

module.exports = { odataKey, odataLit }