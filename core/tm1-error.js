'use strict'

// ── TM1 error normalisation ──────────────────────────────────────────────────
// One shape for every adapter: the message is TM1's own error text when there is
// one, otherwise "HTTP <status> <statusText>". The response, status and TM1 flag
// stay on the error so routes can map the status without parsing a message.
//
// Axios (paw_native, paw_oauth2) and the direct adapter's _settle all funnel
// through here, so "Request failed with status code 400" never reaches a user.

function normalizeError(err) {
    const e = err instanceof Error ? err : new Error(String(err?.message ?? 'TM1 request failed'))
    const res = e.response ?? err?.response ?? null
    const body = res?.data
    const tm1 = body?.error
    const tm1Message = typeof tm1 === 'string' ? tm1 : tm1?.message
    const status = res?.status ?? e.status ?? err?.status
    const statusText = res?.statusText || ''

    if (tm1Message) e.message = String(tm1Message)
    else if (status) e.message = `HTTP ${status}${statusText ? ` ${statusText}` : ''}`

    if (status) e.status = status
    if (res) e.response = res
    e.tm1 = !!res
    if (tm1?.code !== undefined && e.code === undefined) e.code = tm1.code
    return e
}

// Build an Error from a raw response object (the direct adapter's _settle path).
function responseError(res) {
    const e = new Error('TM1 request failed')
    e.response = res
    return normalizeError(e)
}

module.exports = { normalizeError, responseError }
