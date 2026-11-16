// One HTTP layer for the client. hooks/useApi.js is the normal way to read or
// write server state; this module is the low-level helper it builds on, plus
// the few genuine one-offs (sign-in, downloads, streams).
export const authHeader = () => ({ 'x-ide-token': localStorage.getItem('tm1-token') ?? '' })

export const extractError = async (r) => {
  // A 401 means "your IDE session ended" — except a rejected sign-in (the login
  // page must show its error, not reset itself) and a per-server login request.
  if (r.status === 401 && !/\/api\/auth\/login$/.test(new URL(r.url, location.href).pathname)) {
    const d = await r.clone().json().catch(() => null)
    if (!d?.needsServerLogin) window.dispatchEvent(new CustomEvent('tm1-unauthorized'))
  }
  try {
    const d = await r.json()
    const err = new Error(d.error || d.message || r.statusText)
    err.data = d
    return err
  } catch { return new Error(r.statusText) }
}

export const get = (url) => fetch(url, { headers: authHeader() }).then(async r => {
  if (!r.ok) throw await extractError(r)
  return r.json()
})

export const post = (url, body) => fetch(url, {
  method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeader() }, body: JSON.stringify(body),
}).then(async r => {
  if (!r.ok) throw await extractError(r)
  const d = await r.json()
  if (d?.noSession) window.dispatchEvent(new CustomEvent('tm1-no-session'))
  return d
})

export const patch = (url, body) => fetch(url, {
  method: 'PATCH', headers: { 'Content-Type': 'application/json', ...authHeader() }, body: JSON.stringify(body),
}).then(async r => { if (!r.ok) throw await extractError(r); return r.json() })

export const del = (url) => fetch(url, { method: 'DELETE', headers: authHeader() }).then(async r => {
  if (!r.ok) throw await extractError(r)
  return r.json()
})

// For a response that is not JSON (download, streamed reply). The caller owns the body.
export const postRaw = (url, body) => fetch(url, {
  method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeader() }, body: JSON.stringify(body),
}).then(async r => { if (!r.ok) throw await extractError(r); return r })

// Authenticated fetch for a genuine one-off that is not JSON-shaped (download,
// stream, file upload). Server state and saves belong in hooks/useApi.js.
export const apiFetch = (input, init = {}) => {
  const url = typeof input === 'string' ? input : input?.url ?? ''
  if (!url.startsWith('/api/')) return fetch(input, init)
  const headers = new Headers(init.headers ?? (typeof input !== 'string' ? input.headers : undefined))
  if (!headers.has('x-ide-token')) headers.set('x-ide-token', authHeader()['x-ide-token'])
  return fetch(input, { ...init, headers })
}
