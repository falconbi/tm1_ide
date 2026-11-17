export default function VariablesPanel({ variables }) {
  if (!variables?.length) return (
    <div className="px-4 py-3 text-xs text-muted-foreground">No variables</div>
  )
  return (
    <div className="overflow-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-border bg-muted text-muted-foreground">
            <th className="text-left px-3 py-1.5">#</th>
            <th className="text-left px-3 py-1.5">Name</th>
            <th className="text-left px-3 py-1.5">Type</th>
          </tr>
        </thead>
        <tbody>
          {variables.map(v => (
            <tr key={v.Name} className="border-b border-border hover:bg-muted/50">
              <td className="px-3 py-1.5 text-muted-foreground">{v.Position ?? '—'}</td>
              <td className="px-3 py-1.5 font-mono">{v.Name}</td>
              <td className="px-3 py-1.5 text-muted-foreground">{v.Type}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
