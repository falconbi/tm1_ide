import { useState, useEffect } from 'react'
import { useStore } from '@/store'
import { useLogin } from '@/hooks/useApi'
import { toast } from 'sonner'

export default function LoginPage() {
  const { setAuth } = useStore()
  const login = useLogin()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError]       = useState(null)
  // null = still checking; { loginRequired, servers, loginServer, access }
  const [cfg, setCfg]           = useState(null)
  const [setup, setSetup]       = useState(false)   // "Brand-new server?" path
  const [newPwd, setNewPwd]     = useState('')
  const [newPwd2, setNewPwd2]   = useState('')
  const [busy, setBusy]         = useState(false)
  const [via, setVia]           = useState('')

  // Architect model: a local-only IDE has no IDE login — open straight in and
  // sign in to each server as you use it. Only a network-exposed IDE (or
  // IDE_LOGIN=always) shows this sign-in page.
  useEffect(() => {
    let cancelled = false
    fetch('/api/config').then(r => r.json()).then(async c => {
      if (cancelled) return
      if (!c.loginRequired) {
        const r = await fetch('/api/auth/local-session', { method: 'POST' })
        if (r.ok) { const { token, username: u } = await r.json(); if (!cancelled) setAuth(token, u) ; return }
      }
      setCfg(c); setVia(c.loginServer ?? c.servers?.[0] ?? '')
    }).catch(() => { if (!cancelled) setCfg({ loginRequired: true, servers: [] }) })
    return () => { cancelled = true }
  }, [setAuth])

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError(null)
    try {
      const { token, username: user, warning } = await login.mutateAsync({ username, password, server: via || undefined })
      setAuth(token, user)
      if (warning) setTimeout(() => toast.warning(warning, { duration: 12_000 }), 600)
    } catch (err) {
      setError(err.message ?? 'Login failed')
    }
  }

  // Brand-new server: one attempt as admin with a blank password, then the
  // password MUST be set before signing in — never left on a blank password.
  const handleSetup = async (e) => {
    e.preventDefault()
    setError(null)
    if (newPwd !== newPwd2) { setError("The two passwords don't match"); return }
    setBusy(true)
    try {
      const r = await fetch('/api/auth/setup-login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ server: via, newPassword: newPwd }) })
      const d = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(d.error ?? 'Setup failed')
      setAuth(d.token, d.username)
      setTimeout(() => toast.success(`${via}: admin password set — signed in as admin`), 600)
    } catch (err) { setError(err.message) } finally { setBusy(false) }
  }

  if (!cfg) {
    return <div className="flex h-screen items-center justify-center bg-background text-xs text-muted-foreground">Starting…</div>
  }

  return (
    <div className="flex h-screen items-center justify-center bg-background text-foreground">
      <form onSubmit={handleSubmit} className="w-80 flex flex-col gap-4">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">TM1 IDE</h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            {cfg.access === 'network'
              ? 'This IDE is reachable from the network — sign in through any TM1 server you have an account on.'
              : 'Sign in through any TM1 server you have an account on.'}
          </p>
        </div>

        <div className="flex flex-col gap-2">
          {cfg.servers?.length > 0 && (
            <select value={via} onChange={e => setVia(e.target.value)}
              className="w-full bg-muted border border-border rounded px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring">
              {cfg.servers.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          )}
        </div>
        {setup ? (
          <div className="flex flex-col gap-2">
            <p className="text-xs text-muted-foreground">
              A brand-new TM1 server has user <span className="font-mono">admin</span> with a blank password. The IDE signs in
              that way <b>once</b>, sets the password below, then signs you in with it.
            </p>
            <input autoFocus type="password" placeholder="New admin password" value={newPwd} onChange={e => setNewPwd(e.target.value)}
              className="w-full bg-muted border border-border rounded px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring" />
            <input type="password" placeholder="Repeat password" value={newPwd2} onChange={e => setNewPwd2(e.target.value)}
              className="w-full bg-muted border border-border rounded px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring" />
            {error && <p className="text-xs text-red-400">{error}</p>}
            <button type="button" onClick={handleSetup} disabled={!via || !newPwd || !newPwd2 || busy}
              className="w-full py-2 rounded bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 disabled:opacity-40 transition-colors">
              {busy ? 'Setting up…' : 'Set password and sign in'}
            </button>
            <button type="button" onClick={() => { setSetup(false); setError(null) }} className="text-[11px] text-muted-foreground hover:text-foreground self-start">
              ← Back to sign in
            </button>
          </div>
        ) : (
          <>
          <div className="flex flex-col gap-2">
          <input
            autoFocus
            type="text"
            placeholder="Username"
            value={username}
            onChange={e => setUsername(e.target.value)}
            className="w-full bg-muted border border-border rounded px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
          />
          <input
            type="password"
            placeholder="Password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            className="w-full bg-muted border border-border rounded px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
          />
        </div>

        {error && (
          <p className="text-xs text-red-400">{error}</p>
        )}

        <button
          type="submit"
          disabled={!username || !password || login.isPending}
          className="w-full py-2 rounded bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 disabled:opacity-40 transition-colors"
        >
          {login.isPending ? 'Signing in…' : 'Sign in'}
        </button>
            <button type="button" onClick={() => { setSetup(true); setError(null) }}
              className="text-[11px] text-muted-foreground hover:text-foreground hover:underline self-start">
              Brand-new server with a blank admin password? Set it up…
            </button>
          </>
        )}
      </form>
    </div>
  )
}
