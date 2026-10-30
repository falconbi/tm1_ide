'use strict'

// Query options for TM1's REST API ($filter, $orderby, $select …).
// axios's default turns a space into '+', which TM1 does not read as a space —
// "Cube eq 'A'" arrives as "Cube+eq+'A'" and TM1 answers "Unsupported token".
// This is axios's own encoding with one difference: a space stays %20.
function encode(v) {
    return encodeURIComponent(v)
        .replace(/%3A/gi, ':').replace(/%24/g, '$').replace(/%2C/gi, ',')
        .replace(/%5B/gi, '[').replace(/%5D/gi, ']')
}

function serializeParams(params) {
    return Object.entries(params ?? {})
        .filter(([, v]) => v !== undefined && v !== null)
        .map(([k, v]) => `${encode(k)}=${encode(v instanceof Date ? v.toISOString() : String(v))}`)
        .join('&')
}

const paramsSerializer = { serialize: serializeParams }

module.exports = { serializeParams, paramsSerializer }
