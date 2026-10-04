import { useState, useEffect, useRef } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { KeyRound, X, ChevronRight, ChevronDown } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { serverLogin, setupServer } from '@/hooks/useApi'

// Sign in to one TM1 server. Opens when the server answers "needsServerLogin"
// (the 'tm1-server-login' event raised by the fetch wrapper in useApi.js).
// Every TM1 server has its own login — nothing is retried automatically: each
// attempt here is one click, so TM1's MaximumLoginAttempts can't be tripped by
// the IDE itself.
export default function ServerLoginDialog() {
  const qc = useQueryClient()
  const [server, setServer]     = useState(null)
  const [rejected, setRejected] = useState(false)
  const [mode, setMode]         = useState('login')   // 'login' | 'setup'
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [namespace, setNamespace] = useState('')
  const [info, setInfo]         = useState(null)    // GET /api/auth/method result
  const [showInfo, setShowInfo] = useState(false)
  const [newPwd, setNewPwd]     = useState('')
  const [newPwd2, setNewPwd2]   = useState('')
  const [error, setError]       = useState(null)
  const [busy, setBusy]         = useState(false)
  // Servers the user closed the dialog for — don't reopen on every background poll.
  const [dismissed, setDismissed] = useState(() => new Set())

  const openRef = useRef(null)   // the server the dialog is showing (read by the event handler)

  useEffect(() => {
    const onNeed = (e) => {
      const { server: s, rejected: r, force } = e.detail ?? {}
      if (!s || openRef.current) return                          // one dialog at a time
      if (!force && dismissed.has(s.toLowerCase())) return
      openRef.current = s
      setRejected(!!r); setMode('login'); setError(null)
      setPassword(''); setNewPwd(''); setNewPwd2('')
      // Remembered per server: username + CAM namespace — never the password.
      const saved = readSaved(s)
      setUsername(saved.username ?? ''); setNamespace(saved.namespace ?? '')
      setInfo(null); setShowInfo(false)
      setServer(s)
      // Ask the server how it wants to be signed in to (no credentials sent).
      fetch(`/api/auth/method?server=${encodeURIComponent(s)}`).then(r => r.json()).then(d => {
        if (openRef.current !== s) return
        setInfo(d)
        if (d.method === 'cam' && d.camNamespace) setNamespace(n => n || d.camNamespace)
      }).catch(() => {})
    }
    window.addEventListener('tm1-server-login', onNeed)
    return () => window.removeEventListener('tm1-server-login', onNeed)
  }, [dismissed])

  if (!server) return null

  const close = () => {
    setDismissed(d => new Set(d).add(server.toLowerCase()))
    openRef.current = null
    setServer(null)
  }

  const done = (msg) => {
    toast.success(msg)
    setDismissed(d => { const n = new Set(d); n.delete(server.toLowerCase()); return n })
    openRef.current = null
    setServer(null)
    qc.invalidateQueries()
  }

  const run = async (fn) => {
    setBusy(true); setError(null)
    try { await fn() } catch (e) { setError(e.message ?? 'Sign-in failed') } finally { setBusy(false) }
  }

  const signIn = (useCurrent) => run(async () => {
    const r = await serverLogin(useCurrent ? { server, useCurrent: true } : { server, username, password, namespace: isCam ? namespace : undefined })
    if (!useCurrent) saveSigned(server, { username, namespace: isCam ? namespace : undefined })
    if (r?.warning) setTimeout(() => toast.warning(r.warning, { duration: 12_000 }), 300)
    done(`Signed in to ${server}${r?.username ? ` as ${r.username}` : ''}`)
  })

  const setup = () => run(async () => {
    if (newPwd !== newPwd2) throw new Error('The two passwords don\'t match')
    await setupServer({ server, newPassword: newPwd })
    done(`${server}: admin password set — signed in as admin`)
  })

  const field = 'w-full bg-muted border border-border rounded px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring'
  const method = info?.method
  const isCam = method === 'cam'
  const METHOD_LABEL = {
    native: 'TM1 security (or LDAP password check)',
    cam: 'Cognos (CAM) — username, password and namespace',
    'native-or-windows': 'TM1 security or Windows sign-in (mode 2)',
    integrated: 'Windows sign-in only (mode 3)',
    paw: 'Through PAW',
    unreachable: 'Server not reachable',
    unknown: 'Unknown',
  }

  return (
    <div className="fixed inset-0 z-[3000] flex items-center justify-center bg-black/40" onMouseDown={close}>
      <div className="w-96 rounded-lg border border-border bg-background p-5 shadow-xl" onMouseDown={e => e.stopPropagation()}>
        <div className="flex items-start gap-2 mb-4">
          <KeyRound size={16} className="mt-0.5 text-muted-foreground shrink-0" />
          <div className="flex-1 min-w-0">
            <h2 className="text-sm font-semibold">{mode === 'setup' ? 'Set up new server' : 'Sign in to server'}</h2>
            <p className="text-xs text-muted-foreground mt-0.5 truncate">
              <span className="font-mono text-foreground">{server}</span>
              {mode === 'login' && ' has its own login.'}
            </p>
          </div>
          <button onClick={close} className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-muted" title="Not now">
            <X size={14} />
          </button>
        </div>

        {mode === 'login' && (
          <p className="mb-3 text-[11px] text-muted-foreground">
            Sign-in method: <span className="text-foreground">{info ? (METHOD_LABEL[method] ?? method) : 'checking…'}</span>
          </p>
        )}

        {method === 'integrated' && mode === 'login' && (
          <p className="mb-3 text-xs text-amber-500">This server only accepts Windows sign-in, which the IDE doesn't support yet.</p>
        )}

        {rejected && mode === 'login' && (
          <p className="mb-3 text-xs text-amber-500">TM1 rejected the last login for this server. It won't be retried — sign in again.</p>
        )}

        {mode === 'login' ? (
          <form onSubmit={e => { e.preventDefault(); signIn(false) }} className="flex flex-col gap-2">
            <input autoFocus type="text" placeholder="Username" value={username} onChange={e => setUsername(e.target.value)} className={field} />
            <input type="password" placeholder="Password" value={password} onChange={e => setPassword(e.target.value)} className={field} />
            {isCam && (
              <input type="text" placeholder="Namespace (e.g. AD)" value={namespace} onChange={e => setNamespace(e.target.value)} className={field}
                title="The Cognos namespace — the directory Cognos checks your password against" />
            )}
            {isCam && (
              <p className="text-[10px] text-muted-foreground">
                CAM sign-in follows IBM's documented format (as used by TM1py) but hasn't yet been confirmed on a live CAM server.
                Single sign-on is planned.
              </p>
            )}
            {error && <p className="text-xs text-red-400">{error}</p>}
            <button type="submit" disabled={!username || (isCam && !namespace) || busy}
              className="w-full py-2 rounded bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 disabled:opacity-40 transition-colors">
              {busy ? 'Signing in…' : 'Sign in'}
            </button>
            <button type="button" disabled={busy} onClick={() => signIn(true)}
              className="w-full py-1.5 rounded border border-border text-xs text-muted-foreground hover:text-foreground hover:bg-muted disabled:opacity-40"
              title="One attempt with the username and password you signed in to the IDE with">
              Use my current login
            </button>
            <button type="button" onClick={() => { setMode('setup'); setError(null) }}
              className="mt-1 text-[11px] text-muted-foreground hover:text-foreground underline-offset-2 hover:underline self-start">
              Brand-new server with a blank admin password? Set it up…
            </button>
            <button type="button" onClick={() => setShowInfo(v => !v)}
              className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground self-start">
              {showInfo ? <ChevronDown size={11} /> : <ChevronRight size={11} />} Connection details
            </button>
            {showInfo && (
              <div className="rounded border border-border bg-muted/40 p-2 text-[10px] font-mono leading-relaxed break-all">
                {!info ? 'checking…' : info.error ? `Not reachable: ${info.error}` : (
                  <>
                    <div>address: {info.url ?? '—'}</div>
                    <div>encryption: {info.tls ?? '—'}</div>
                    <div>answer without credentials: {info.status ?? '—'}</div>
                    <div>accepts: {info.wwwAuthenticate || '—'}</div>
                    {info.camGateway && <div>Cognos gateway: {info.camGateway}</div>}
                    <div className="mt-1 font-sans text-muted-foreground">Checked without sending any credentials — safe to share.</div>
                  </>
                )}
              </div>
            )}
          </form>
        ) : (
          <form onSubmit={e => { e.preventDefault(); setup() }} className="flex flex-col gap-2">
            <p className="text-xs text-muted-foreground">
              A new TM1 server (native security) starts with user <span className="font-mono">admin</span> and a blank
              password. The IDE signs in that way <b>once</b>, sets the password below, then signs in with it.
            </p>
            <input autoFocus type="password" placeholder="New admin password" value={newPwd} onChange={e => setNewPwd(e.target.value)} className={field} />
            <input type="password" placeholder="Repeat password" value={newPwd2} onChange={e => setNewPwd2(e.target.value)} className={field} />
            {error && <p className="text-xs text-red-400">{error}</p>}
            <button type="submit" disabled={!newPwd || !newPwd2 || busy}
              className={cn('w-full py-2 rounded text-sm font-medium transition-colors disabled:opacity-40',
                'bg-primary text-primary-foreground hover:bg-primary/90')}>
              {busy ? 'Setting up…' : 'Set password and sign in'}
            </button>
            <button type="button" onClick={() => { setMode('login'); setError(null) }}
              className="mt-1 text-[11px] text-muted-foreground hover:text-foreground hover:underline self-start">
              ← Back to sign in
            </button>
          </form>
        )}
      </div>
    </div>
  )
}

// Per-server sign-in preferences in this browser: username + CAM namespace only.
function readSaved(server) {
  try { return JSON.parse(localStorage.getItem(`tm1-signin:${server.toLowerCase()}`) ?? '{}') } catch { return {} }
}
function saveSigned(server, prefs) {
  try { localStorage.setItem(`tm1-signin:${server.toLowerCase()}`, JSON.stringify(prefs)) } catch { /* storage unavailable */ }
}
