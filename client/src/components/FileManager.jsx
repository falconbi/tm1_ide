import { useState, useRef } from 'react'
import { X, RefreshCw, Loader2, Folder, FileText, Upload, Download, Trash2, ChevronRight, Home } from 'lucide-react'
import { useQueryClient } from '@tanstack/react-query'
import { useQuery, useMutation } from '@tanstack/react-query'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'

const enc = encodeURIComponent

function get(url) {
  return fetch(url).then(async r => {
    if (!r.ok) { const d = await r.json().catch(() => ({})); throw new Error(d.error || r.statusText) }
    return r.json()
  })
}

function fmtSize(n) {
  if (n == null) return ''
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}

export default function FileManager({ server, onClose }) {
  const [pathParts, setPathParts] = useState(['Files'])
  const [deleting,  setDeleting]  = useState(null)
  const fileInputRef = useRef(null)
  const qc = useQueryClient()

  const pathKey = JSON.stringify(pathParts)

  const files = useQuery({
    queryKey: ['files', server, pathKey],
    queryFn:  () => get(`/api/files/list?server=${enc(server)}&path=${enc(pathKey)}`),
    enabled:  !!server,
  })

  const upload = useMutation({
    mutationFn: async ({ name, buffer }) => {
      const r = await fetch(
        `/api/files/upload?server=${enc(server)}&path=${enc(pathKey)}&name=${enc(name)}`,
        { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: buffer }
      )
      const d = await r.json()
      if (!r.ok) throw new Error(d.error || 'Upload failed')
      return d
    },
    onSuccess: (_, { name }) => {
      toast.success(`Uploaded: ${name}`)
      qc.invalidateQueries({ queryKey: ['files', server, pathKey] })
    },
    onError: (e) => toast.error(e.message),
  })

  const deleteFile = useMutation({
    mutationFn: (name) =>
      fetch(`/api/files?server=${enc(server)}&path=${enc(pathKey)}&name=${enc(name)}`, { method: 'DELETE' })
        .then(r => r.json()),
    onSuccess: (_, name) => {
      toast.success(`Deleted: ${name}`)
      setDeleting(null)
      qc.invalidateQueries({ queryKey: ['files', server, pathKey] })
    },
    onError: (e) => toast.error(e.message),
  })

  const handleFileInput = async (e) => {
    const picked = [...(e.target.files ?? [])]
    if (!picked.length) return
    for (const file of picked) {
      const buffer = await file.arrayBuffer()
      upload.mutate({ name: file.name, buffer })
    }
    e.target.value = ''
  }

  const handleDownload = (name) => {
    const url = `/api/files/content?server=${enc(server)}&path=${enc(pathKey)}&name=${enc(name)}`
    const a = Object.assign(document.createElement('a'), { href: url, download: name })
    a.click()
  }

  const navigateTo = (folder) => setPathParts([...pathParts, folder])
  const navigateUp = (idx) => setPathParts(pathParts.slice(0, idx + 1))

  const entries = files.data ?? []
  const folders = entries.filter(f => f.isFolder).sort((a, b) => a.name.localeCompare(b.name))
  const docs    = entries.filter(f => !f.isFolder).sort((a, b) => a.name.localeCompare(b.name))

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div
        className="bg-background border border-border rounded-lg shadow-2xl flex flex-col overflow-hidden"
        style={{ width: 700, height: 520 }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border shrink-0">
          <div className="flex items-center gap-2">
            <Folder size={13} className="text-muted-foreground" />
            <span className="text-sm font-semibold">File Manager</span>
          </div>
          <div className="flex items-center gap-1.5">
            <button
              onClick={() => fileInputRef.current?.click()}
              title="Upload file(s)"
              className="flex items-center gap-1.5 px-2.5 py-1 text-xs rounded border border-border hover:bg-muted transition-colors"
            >
              {upload.isPending ? <Loader2 size={11} className="animate-spin" /> : <Upload size={11} />}
              Upload
            </button>
            <input ref={fileInputRef} type="file" multiple onChange={handleFileInput} className="hidden" />
            <button
              onClick={() => qc.invalidateQueries({ queryKey: ['files', server, pathKey] })}
              title="Refresh"
              className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            >
              {files.isFetching ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
            </button>
            <button onClick={onClose} className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors">
              <X size={14} />
            </button>
          </div>
        </div>

        {/* Breadcrumb */}
        <div className="flex items-center gap-0.5 px-4 py-1.5 border-b border-border bg-muted/20 shrink-0 text-xs">
          {pathParts.map((part, i) => (
            <span key={i} className="flex items-center gap-0.5">
              {i > 0 && <ChevronRight size={10} className="text-muted-foreground/40" />}
              <button
                onClick={() => navigateUp(i)}
                className={cn(
                  'px-1 py-0.5 rounded transition-colors',
                  i === pathParts.length - 1
                    ? 'text-foreground font-medium cursor-default'
                    : 'text-muted-foreground hover:text-foreground hover:bg-muted'
                )}
              >
                {i === 0 ? <Home size={10} /> : part}
              </button>
            </span>
          ))}
        </div>

        {/* File list */}
        <div className="flex-1 min-h-0 overflow-auto">
          {files.isLoading && (
            <div className="flex items-center gap-2 px-4 py-6 text-xs text-muted-foreground">
              <Loader2 size={11} className="animate-spin" /> Loading…
            </div>
          )}
          {files.isError && (
            <p className="px-4 py-6 text-xs text-red-400">{files.error?.message}</p>
          )}
          {!files.isLoading && !files.isError && entries.length === 0 && (
            <p className="px-4 py-6 text-xs text-muted-foreground italic text-center">Folder is empty.</p>
          )}
          {(folders.length > 0 || docs.length > 0) && (
            <table className="w-full text-xs">
              <thead>
                <tr className="sticky top-0 bg-background border-b border-border">
                  <th className="text-left px-4 py-2 font-medium text-muted-foreground">Name</th>
                  <th className="text-right px-4 py-2 font-medium text-muted-foreground w-20">Size</th>
                  <th className="w-20 px-4 py-2" />
                </tr>
              </thead>
              <tbody>
                {folders.map(f => (
                  <tr key={f.name} className="border-b border-border/30 hover:bg-muted/20 cursor-pointer" onClick={() => navigateTo(f.name)}>
                    <td className="px-4 py-2">
                      <div className="flex items-center gap-2">
                        <Folder size={12} className="text-amber-400 shrink-0" />
                        <span className="font-medium">{f.name}</span>
                      </div>
                    </td>
                    <td className="px-4 py-2 text-right text-muted-foreground">—</td>
                    <td className="px-4 py-2" />
                  </tr>
                ))}
                {docs.map(f => (
                  <tr key={f.name} className="border-b border-border/30 hover:bg-muted/20 group">
                    <td className="px-4 py-2">
                      <div className="flex items-center gap-2">
                        <FileText size={12} className="text-muted-foreground shrink-0" />
                        <span>{f.name}</span>
                      </div>
                    </td>
                    <td className="px-4 py-2 text-right font-mono text-muted-foreground">{fmtSize(f.size)}</td>
                    <td className="px-4 py-2">
                      <div className="flex items-center gap-1 justify-end opacity-0 group-hover:opacity-100 transition-opacity">
                        <button
                          onClick={() => handleDownload(f.name)}
                          title="Download"
                          className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                        ><Download size={11} /></button>
                        {deleting === f.name ? (
                          <div className="flex items-center gap-1">
                            <button
                              onClick={() => deleteFile.mutate(f.name)}
                              disabled={deleteFile.isPending}
                              className="px-1.5 py-0.5 text-[10px] rounded bg-red-600 text-white hover:bg-red-500 disabled:opacity-40"
                            >Confirm</button>
                            <button onClick={() => setDeleting(null)} className="px-1.5 py-0.5 text-[10px] rounded border border-border hover:bg-muted">Cancel</button>
                          </div>
                        ) : (
                          <button
                            onClick={() => setDeleting(f.name)}
                            title="Delete"
                            className="p-1 rounded text-muted-foreground hover:text-destructive hover:bg-muted transition-colors"
                          ><Trash2 size={11} /></button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* Footer */}
        <div className="px-4 py-1.5 border-t border-border shrink-0 text-[10px] text-muted-foreground flex items-center justify-between">
          <span>{docs.length} file{docs.length !== 1 ? 's' : ''}{folders.length > 0 ? `, ${folders.length} folder${folders.length !== 1 ? 's' : ''}` : ''}</span>
          <span className="italic">TM1 server file system — {server}</span>
        </div>
      </div>
    </div>
  )
}
