export function sessionKey(session) {
  return session?.Name ?? session?.ID ?? session?.SessionID ?? null
}
