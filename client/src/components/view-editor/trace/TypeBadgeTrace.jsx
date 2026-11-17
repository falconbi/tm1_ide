function TypeBadgeTrace({ type }) {
    const t = type?.toLowerCase() ?? ''
    if (t.includes('rule'))   return <span className="badge bg-amber-500/20 text-amber-400">RULE</span>
    if (t.includes('consol')) return <span className="badge bg-purple-500/20 text-purple-400">CONSOLIDATED</span>
    if (t.includes('feed'))   return <span className="badge bg-blue-500/20 text-blue-400">FEEDER</span>
    if (t.includes('base') || t === 'leaf') return <span className="badge bg-emerald-500/20 text-emerald-400">BASE</span>
    if (type) return <span className="badge bg-muted text-muted-foreground">{type.toUpperCase()}</span>
    return null
}

export default TypeBadgeTrace
