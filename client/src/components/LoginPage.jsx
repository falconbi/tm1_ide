import { useState } from 'react'
import { useStore } from '@/store'
import { useLogin } from '@/hooks/useApi'

export default function LoginPage() {
  const { setAuth } = useStore()
  const login = useLogin()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError]       = useState(null)

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError(null)
    try {
      const { token, username: user } = await login.mutateAsync({ username, password })
      setAuth(token, user)
    } catch (err) {
      setError(err.message ?? 'Login failed')
    }
  }

  return (
    <div className="flex h-screen items-center justify-center bg-background text-foreground">
      <form onSubmit={handleSubmit} className="w-80 flex flex-col gap-4">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">TM1 IDE</h1>
          <p className="text-xs text-muted-foreground mt-0.5">Sign in with your PAW credentials</p>
        </div>

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
      </form>
    </div>
  )
}
