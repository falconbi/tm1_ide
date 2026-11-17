import { useRef, useState } from 'react'
import { Loader2, Upload } from 'lucide-react'
import { toast } from 'sonner'
import { request } from '@/lib/api'
import { useCubes, useViews } from '@/hooks/useApi'

export default function DatasourcePanel({ ds, server, onChange }) {
  const type = ds?.Type ?? 'None'
  const set  = (k, v) => onChange({ ...ds, Type: type, [k]: v })
  const csvInputRef = useRef(null)
  const [csvUploading, setCsvUploading] = useState(false)
  const enc = encodeURIComponent

  const handleCsvUpload = async (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    setCsvUploading(true)
    try {
      const buffer = await file.arrayBuffer()
      const r = await request(
        `/api/files/upload?server=${enc(server)}&name=${enc(file.name)}`,
        { method: 'POST', headers: { 'Content-Type': 'application/octet-stream', 'x-ide-token': localStorage.getItem('tm1-token') ?? '' }, body: buffer }
      )
      const d = await r.json()
      if (!r.ok) throw new Error(d.error || 'Upload failed')
      set('dataSourceNameForServer', file.name)
      toast.success(`Uploaded: ${file.name}`)
    } catch (err) {
      toast.error(err.message)
    } finally {
      setCsvUploading(false)
      e.target.value = ''
    }
  }

  const { data: cubes }  = useCubes(server)
  const { data: views }  = useViews(server, type === 'TM1CubeView' ? (ds?.dataSourceNameForServer ?? '') : null)

  const row = (label, key, opts = {}) => (
    <div key={key} className="flex items-center gap-3">
      <span className="text-[10px] text-muted-foreground w-28 shrink-0">{label}</span>
      <input
        type={opts.type ?? 'text'}
        value={ds?.[key] ?? opts.default ?? ''}
        onChange={e => set(key, e.target.value)}
        placeholder={opts.placeholder ?? ''}
        className="flex-1 bg-transparent border-b border-border focus:border-primary text-xs font-mono py-0.5 focus:outline-none"
      />
    </div>
  )

  const sel = (label, key, options, loading) => (
    <div key={key} className="flex items-center gap-3">
      <span className="text-[10px] text-muted-foreground w-28 shrink-0">{label}</span>
      <select
        value={ds?.[key] ?? ''}
        onChange={e => set(key, e.target.value)}
        className="flex-1 bg-muted border border-border rounded px-1.5 py-0.5 text-xs font-mono focus:outline-none"
      >
        <option value="">{loading ? 'Loading…' : 'Select…'}</option>
        {(options ?? []).map(o => typeof o === 'string' ? o : (o?.name ?? o?.Name)).filter(Boolean).map(o => <option key={o} value={o}>{o}</option>)}
      </select>
    </div>
  )

  return (
    <div className="px-3 py-2 space-y-2.5">
      <div className="flex items-center gap-3">
        <span className="text-[10px] text-muted-foreground w-28 shrink-0">Type</span>
        <select
          value={type}
          onChange={e => onChange({ Type: e.target.value })}
          className="flex-1 bg-muted border border-border rounded px-1.5 py-0.5 text-xs font-mono focus:outline-none"
        >
          <option value="None">None (no data loop)</option>
          <option value="ASCII">ASCII File</option>
          <option value="ODBC">ODBC</option>
          <option value="TM1CubeView">TM1 Cube View</option>
          <option value="TM1DimensionSubset">TM1 Dimension Subset</option>
        </select>
      </div>

      {type === 'ASCII' && <>
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-muted-foreground w-28 shrink-0">File (server)</span>
          <input
            type="text"
            value={ds?.dataSourceNameForServer ?? ''}
            onChange={e => set('dataSourceNameForServer', e.target.value)}
            placeholder=".\\data\\file.csv"
            className="flex-1 bg-transparent border-b border-border focus:border-primary text-xs font-mono py-0.5 focus:outline-none"
          />
          <input type="file" accept=".csv,.txt,.asc" ref={csvInputRef} onChange={handleCsvUpload} className="hidden" />
          <button
            onClick={() => csvInputRef.current?.click()}
            disabled={csvUploading}
            className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground border border-border rounded px-1.5 py-0.5 disabled:opacity-50 shrink-0"
          >
            {csvUploading ? <Loader2 size={12} className="animate-spin" /> : <Upload size={12} />}
            Upload
          </button>
        </div>
        {row('File (client)', 'dataSourceNameForClient', { placeholder: 'Leave blank = mirror server' })}
        {row('Delimiter char', 'asciiDelimiterChar', { placeholder: ',', default: ',' })}
        {row('Header rows', 'asciiHeaderRecords', { type: 'number', default: '1' })}
        {row('Quote char', 'asciiQuoteCharacter', { placeholder: '"' })}
      </>}

      {type === 'ODBC' && <>
        {row('DSN', 'dataSourceNameForServer', { placeholder: 'MyDatabase' })}
        <div className="flex items-start gap-3">
          <span className="text-[10px] text-muted-foreground w-28 shrink-0 pt-1">SQL query</span>
          <textarea
            value={ds?.query ?? ''}
            onChange={e => set('query', e.target.value)}
            rows={3}
            placeholder="SELECT col1, col2 FROM table"
            className="flex-1 bg-muted border border-border rounded px-2 py-1 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-ring resize-none"
          />
        </div>
        {row('Username', 'userName', { placeholder: 'Optional' })}
      </>}

      {type === 'TM1CubeView' && <>
        {sel('Cube', 'dataSourceNameForServer', cubes)}
        {sel('View', 'view', views)}
      </>}

      {type === 'TM1DimensionSubset' && <>
        {row('Dimension', 'dataSourceNameForServer', { placeholder: 'CostCentre' })}
        {row('Subset', 'subset', { placeholder: 'All CostCentres' })}
      </>}
    </div>
  )
}
