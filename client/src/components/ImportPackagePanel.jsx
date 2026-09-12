import { useRef, useState } from 'react'
import { FolderArchive, Upload, Rocket, Loader2 } from 'lucide-react'
import { useDeployPackages, useDeployImportZip } from '@/hooks/useApi'
import { useStore } from '@/store'

function fmtDate(iso) {
  if (!iso) return '—'
  try { return new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) }
  catch { return iso }
}

// Deploy a package handed off from another IDE instance (e.g. a consultant's Dev
// box) without needing a connection to that source server at all — just the .zip
// it built. Lists what's already in packages/ and lets you drop in a new one.
export default function ImportPackagePanel() {
  const { openDeployCenter } = useStore()
  const { data: packages = [], isLoading, error, refetch } = useDeployPackages({ imported: true })
  const importMut = useDeployImportZip()
  const fileRef = useRef(null)
  const [uploadError, setUploadError] = useState(null)

  async function handleFile(e) {
    const file = e.target.files?.[0]
    if (!file) return
    setUploadError(null)
    try {
      const bytes = await file.arrayBuffer()
      const result = await importMut.mutateAsync({ bytes, name: file.name.replace(/\.zip$/i, '') })
      refetch()
      deployPackage({ dir: result.dir, name: result.name, meta: result.manifest?._meta, objectCount: result.manifest?.objects?.length ?? 0 })
    } catch (err) { setUploadError(err.message) }
    finally { e.target.value = '' }
  }

  function deployPackage(pkg) {
    openDeployCenter({
      server: pkg.meta?.server ?? '',
      importDir: pkg.dir,
    })
  }

  return (
    <div className="flex flex-col h-full">
      <div className="px-5 py-3 border-b border-border shrink-0">
        <div className="text-sm font-semibold">Import Package</div>
        <div className="text-[11px] text-muted-foreground mt-0.5">
          Deploy a package built on another IDE — upload the .zip you were sent, review it, then deploy to your target. No connection to the source server needed.
        </div>
      </div>

      <div className="px-5 py-4 border-b border-border/50 shrink-0">
        <input ref={fileRef} type="file" accept=".zip" onChange={handleFile} className="hidden" />
        <button
          onClick={() => fileRef.current?.click()}
          disabled={importMut.isPending}
          className="flex items-center gap-2 px-4 py-1.5 rounded text-sm font-medium bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
        >
          {importMut.isPending ? <Loader2 size={13} className="animate-spin" /> : <Upload size={13} />}
          {importMut.isPending ? 'Uploading…' : 'Upload package .zip'}
        </button>
        {uploadError && <p className="text-xs text-red-400 mt-2">{uploadError}</p>}
      </div>

      <div className="flex-1 overflow-auto">
        {isLoading && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground py-12 justify-center">
            <Loader2 size={14} className="animate-spin" /> Loading…
          </div>
        )}
        {error && <div className="text-sm text-red-400 py-8 text-center">{error.message}</div>}
        {!isLoading && !error && packages.length === 0 && (
          <div className="text-sm text-muted-foreground py-12 text-center">No packages here yet — upload one above.</div>
        )}
        {packages.length > 0 && (
          <div className="border border-border rounded m-4 overflow-hidden divide-y divide-border/60">
            {packages.map(p => (
              <div key={p.dir} className="flex items-center gap-3 px-4 py-2.5 hover:bg-muted/30 transition-colors">
                <FolderArchive size={14} className="text-muted-foreground shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-medium truncate">{p.name}</div>
                  <div className="text-[10px] text-muted-foreground mt-0.5">
                    from <span className="text-foreground/80">{p.meta?.server ?? 'unknown'}</span>
                    {' · '}{p.objectCount} object{p.objectCount !== 1 ? 's' : ''}
                    {' · '}{fmtDate(p.meta?.packaged_at)}
                  </div>
                </div>
                <button
                  onClick={() => deployPackage(p)}
                  className="flex items-center gap-1.5 px-3 py-1 rounded text-xs font-medium text-emerald-500 hover:text-emerald-400 hover:bg-muted transition-colors shrink-0"
                >
                  <Rocket size={11} /> Deploy
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
