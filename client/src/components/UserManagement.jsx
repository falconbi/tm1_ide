import { useState } from 'react'
import { X, Plus, Loader2, Eye, EyeOff, Trash2, Check, Shield, Users } from 'lucide-react'
import { useStore } from '@/store'
import { useClients, useGroups, useClientGroups, useCreateClient, useUpdateClient, useDeleteClient, useAddClientToGroup, useRemoveClientFromGroup, useResetClientPassword } from '@/hooks/useApi'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'

function GroupCheckbox({ name, checked, onToggle, disabled }) {
  return (
    <button
      onClick={onToggle}
      disabled={disabled}
      className={cn(
        'flex items-center gap-2 w-full text-left px-2 py-1.5 rounded text-xs hover:bg-muted/60 transition-colors',
        disabled && 'opacity-50 cursor-not-allowed'
      )}
    >
      <span className={cn(
        'w-3.5 h-3.5 rounded border flex items-center justify-center shrink-0 transition-colors',
        checked ? 'bg-primary border-primary' : 'border-border bg-background'
      )}>
        {checked && <Check size={9} className="text-primary-foreground" />}
      </span>
      <span className="font-mono">{name}</span>
    </button>
  )
}

function UserDetail({ server, client, allGroups, onDeleted }) {
  const [newPwd, setNewPwd]         = useState('')
  const [showPwd, setShowPwd]       = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const { username } = useStore()

  const { data: memberGroups = [], isLoading: loadingGroups } = useClientGroups(server, client.Name)
  const updateClient      = useUpdateClient()
  const resetPassword     = useResetClientPassword()
  const deleteClient      = useDeleteClient()
  const addToGroup        = useAddClientToGroup()
  const removeFromGroup   = useRemoveClientFromGroup()

  const memberSet = new Set(memberGroups)
  const isSelf    = client.Name === username
  const groupBusy = addToGroup.isPending || removeFromGroup.isPending

  const handleResetPassword = async () => {
    if (!newPwd.trim()) return
    try {
      await resetPassword.mutateAsync({ server, name: client.Name, password: newPwd })
      toast.success('Password updated')
      setNewPwd('')
    } catch (e) { toast.error(e.message) }
  }

  const handleToggleEnabled = async () => {
    try {
      await updateClient.mutateAsync({ server, name: client.Name, Enabled: !client.Enabled })
      toast.success(client.Enabled ? `${client.Name} disabled` : `${client.Name} enabled`)
    } catch (e) { toast.error(e.message) }
  }

  const handleDelete = async () => {
    try {
      await deleteClient.mutateAsync({ server, name: client.Name })
      toast.success(`User "${client.Name}" deleted`)
      onDeleted()
    } catch (e) { toast.error(e.message) }
  }

  const handleToggleGroup = async (group) => {
    const inGroup = memberSet.has(group)
    try {
      if (inGroup) await removeFromGroup.mutateAsync({ server, name: client.Name, group })
      else         await addToGroup.mutateAsync({ server, name: client.Name, group })
    } catch (e) { toast.error(e.message) }
  }

  return (
    <div className="flex flex-col gap-5">
      {/* Identity */}
      <div className="flex items-center gap-2.5">
        <span className={cn('w-2 h-2 rounded-full shrink-0', client.Enabled ? 'bg-emerald-400' : 'bg-muted-foreground/30')} />
        <span className="text-sm font-semibold font-mono">{client.Name}</span>
        {client.FriendlyName && <span className="text-xs text-muted-foreground">— {client.FriendlyName}</span>}
        {isSelf && <span className="text-[10px] px-1.5 py-px rounded bg-primary/10 text-primary border border-primary/20">you</span>}
        {!client.Enabled && <span className="text-[10px] px-1.5 py-px rounded bg-muted text-muted-foreground">disabled</span>}
      </div>

      {/* Password reset */}
      <div>
        <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-2">Reset Password</div>
        <div className="flex gap-1.5">
          <div className="relative flex-1">
            <input
              type={showPwd ? 'text' : 'password'}
              value={newPwd}
              onChange={e => setNewPwd(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleResetPassword()}
              placeholder="New password…"
              className="w-full bg-muted border border-border rounded px-2.5 py-1.5 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-ring pr-8"
            />
            <button
              onClick={() => setShowPwd(v => !v)}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            >
              {showPwd ? <EyeOff size={11} /> : <Eye size={11} />}
            </button>
          </div>
          <button
            onClick={handleResetPassword}
            disabled={!newPwd.trim() || updateClient.isPending}
            className="px-3 py-1.5 text-xs rounded bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-40 flex items-center gap-1"
          >
            {updateClient.isPending ? <Loader2 size={10} className="animate-spin" /> : 'Set'}
          </button>
        </div>
      </div>

      {/* Groups */}
      <div>
        <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-2 flex items-center gap-1.5">
          Group Membership
          {(loadingGroups || groupBusy) && <Loader2 size={9} className="animate-spin" />}
        </div>
        {allGroups.length === 0 ? (
          <div className="text-xs text-muted-foreground italic">No groups found</div>
        ) : (
          <div className="flex flex-col gap-0.5 max-h-52 overflow-y-auto border border-border rounded p-1 bg-muted/20">
            {allGroups.map(g => (
              <GroupCheckbox
                key={g}
                name={g}
                checked={memberSet.has(g)}
                onToggle={() => handleToggleGroup(g)}
                disabled={groupBusy || loadingGroups}
              />
            ))}
          </div>
        )}
      </div>

      {/* Actions */}
      <div className="flex gap-2 pt-1 border-t border-border">
        <button
          onClick={handleToggleEnabled}
          disabled={isSelf || updateClient.isPending}
          className={cn(
            'flex-1 py-1.5 text-xs rounded border transition-colors disabled:opacity-40',
            client.Enabled
              ? 'border-amber-500/40 text-amber-400 hover:bg-amber-500/10'
              : 'border-emerald-500/40 text-emerald-400 hover:bg-emerald-500/10'
          )}
        >
          {client.Enabled ? 'Disable user' : 'Enable user'}
        </button>

        {!confirmDelete ? (
          <button
            onClick={() => setConfirmDelete(true)}
            disabled={isSelf}
            className="flex items-center gap-1 px-3 py-1.5 text-xs rounded border border-red-500/40 text-red-400 hover:bg-red-500/10 disabled:opacity-40 transition-colors"
          >
            <Trash2 size={11} /> Delete
          </button>
        ) : (
          <div className="flex gap-1.5">
            <button
              onClick={() => setConfirmDelete(false)}
              className="px-2.5 py-1.5 text-xs rounded border border-border text-muted-foreground hover:bg-muted"
            >
              Cancel
            </button>
            <button
              onClick={handleDelete}
              disabled={deleteClient.isPending}
              className="px-2.5 py-1.5 text-xs rounded bg-red-600 text-white hover:bg-red-500 disabled:opacity-40 flex items-center gap-1"
            >
              {deleteClient.isPending ? <Loader2 size={10} className="animate-spin" /> : 'Confirm delete'}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

function CreateUserForm({ server, allGroups, onCreated, onCancel }) {
  const [name,     setName]     = useState('')
  const [password, setPassword] = useState('')
  const [friendly, setFriendly] = useState('')
  const [showPwd,  setShowPwd]  = useState(false)
  const [selGroups, setSelGroups] = useState(new Set(['ADMIN']))

  const createClient = useCreateClient()

  const toggleGroup = (g) => setSelGroups(prev => {
    const next = new Set(prev)
    next.has(g) ? next.delete(g) : next.add(g)
    return next
  })

  const handleCreate = async () => {
    if (!name.trim() || !password.trim()) return
    const trimmed = name.trim()
    try {
      await createClient.mutateAsync({ server, name: trimmed, password, friendlyName: friendly.trim(), groups: [...selGroups] })
      toast.success(`User "${trimmed}" created`, { description: 'Ask them to log into PAW once to activate their workspace profile' })
      onCreated(trimmed)
    } catch (e) { toast.error(e.message) }
  }

  const busy = createClient.isPending

  return (
    <div className="flex flex-col gap-4">
      <div className="text-xs font-semibold">New User</div>

      <input
        autoFocus
        value={name}
        onChange={e => setName(e.target.value)}
        placeholder="Username"
        className="w-full bg-muted border border-border rounded px-2.5 py-1.5 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-ring"
      />

      <div className="relative">
        <input
          type={showPwd ? 'text' : 'password'}
          value={password}
          onChange={e => setPassword(e.target.value)}
          placeholder="Password"
          className="w-full bg-muted border border-border rounded px-2.5 py-1.5 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-ring pr-8"
        />
        <button
          onClick={() => setShowPwd(v => !v)}
          className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
        >
          {showPwd ? <EyeOff size={11} /> : <Eye size={11} />}
        </button>
      </div>

      <input
        value={friendly}
        onChange={e => setFriendly(e.target.value)}
        placeholder="Display name (optional)"
        className="w-full bg-muted border border-border rounded px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
      />

      <div>
        <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-2">Groups</div>
        {allGroups.length === 0 ? (
          <div className="text-xs text-muted-foreground italic">No groups found</div>
        ) : (
          <div className="flex flex-col gap-0.5 max-h-40 overflow-y-auto border border-border rounded p-1 bg-muted/20">
            {allGroups.map(g => (
              <GroupCheckbox
                key={g}
                name={g}
                checked={selGroups.has(g)}
                onToggle={() => toggleGroup(g)}
                disabled={busy}
              />
            ))}
          </div>
        )}
      </div>

      <div className="flex gap-2 pt-1">
        <button
          onClick={onCancel}
          className="flex-1 py-1.5 text-xs rounded border border-border text-muted-foreground hover:bg-muted"
        >
          Cancel
        </button>
        <button
          onClick={handleCreate}
          disabled={!name.trim() || !password.trim() || busy}
          className="flex-1 py-1.5 text-xs rounded bg-emerald-700 text-white hover:bg-emerald-600 disabled:opacity-40 flex items-center justify-center gap-1"
        >
          {busy ? <Loader2 size={10} className="animate-spin" /> : <><Plus size={10} /> Create</>}
        </button>
      </div>
    </div>
  )
}

export default function UserManagement({ server, onClose }) {
  const { data: clients = [], isLoading, isFetching } = useClients(server)
  const { data: groups  = [] }                        = useGroups(server)
  const [selectedName, setSelectedName] = useState(null)
  const [creating, setCreating]         = useState(false)

  const sorted = [...clients].sort((a, b) => a.Name.localeCompare(b.Name))
  const selectedClient = clients.find(c => c.Name === selectedName) ?? null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="w-[700px] max-h-[82vh] bg-popover border border-border rounded-lg shadow-2xl flex flex-col overflow-hidden">

        {/* Header */}
        <div className="flex items-center gap-2 px-4 py-3 border-b border-border bg-muted/30 shrink-0">
          <Shield size={14} className="text-muted-foreground" />
          <span className="text-sm font-semibold">User Management</span>
          <span className="text-xs text-muted-foreground font-mono">— {server}</span>
          {isFetching && <Loader2 size={10} className="animate-spin text-muted-foreground" />}
          <div className="ml-auto flex items-center gap-2">
            <button
              onClick={() => { setCreating(true); setSelectedName(null) }}
              className="flex items-center gap-1 px-2.5 py-1 text-xs rounded bg-emerald-700 text-white hover:bg-emerald-600"
            >
              <Plus size={11} /> New User
            </button>
            <button onClick={onClose} className="p-1.5 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors">
              <X size={13} />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="flex flex-1 min-h-0 overflow-hidden">

          {/* User list */}
          <div className="w-56 shrink-0 border-r border-border overflow-y-auto bg-sidebar flex flex-col">
            {isLoading && (
              <div className="flex items-center justify-center gap-1.5 py-8 text-muted-foreground text-xs">
                <Loader2 size={11} className="animate-spin" /> Loading…
              </div>
            )}
            {sorted.map(c => (
              <button
                key={c.Name}
                onClick={() => { setSelectedName(c.Name); setCreating(false) }}
                className={cn(
                  'flex items-center gap-2 w-full px-3 py-2 text-left text-xs border-b border-border/30 hover:bg-muted/40 transition-colors',
                  selectedName === c.Name && 'bg-muted'
                )}
              >
                <span className={cn('w-1.5 h-1.5 rounded-full shrink-0', c.Enabled ? 'bg-emerald-400' : 'bg-muted-foreground/30')} />
                <div className="flex-1 min-w-0">
                  <div className="font-mono truncate">{c.Name}</div>
                  {c.FriendlyName && <div className="text-[10px] text-muted-foreground/60 truncate">{c.FriendlyName}</div>}
                </div>
              </button>
            ))}
          </div>

          {/* Detail / create panel */}
          <div className="flex-1 overflow-y-auto p-5">
            {creating && (
              <CreateUserForm
                server={server}
                allGroups={groups}
                onCreated={(name) => { setCreating(false); setSelectedName(name) }}
                onCancel={() => setCreating(false)}
              />
            )}
            {!creating && selectedClient && (
              <UserDetail
                key={selectedClient.Name}
                server={server}
                client={selectedClient}
                allGroups={groups}
                onDeleted={() => setSelectedName(null)}
              />
            )}
            {!creating && !selectedClient && (
              <div className="flex flex-col items-center justify-center h-full gap-3 text-muted-foreground/50">
                <Users size={28} />
                <span className="text-xs">Select a user or create a new one</span>
              </div>
            )}
          </div>

        </div>
      </div>
    </div>
  )
}
