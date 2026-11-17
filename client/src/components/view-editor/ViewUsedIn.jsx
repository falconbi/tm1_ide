import { BookOpen, ChevronDown, ChevronUp, Cog, FileSearch, Loader2 } from 'lucide-react'
import { processTabId } from '@/lib/tab-ids'

export default function ViewUsedIn({ tab, openTab, usedIn }) {
    if (!tab.viewName) return null
    return (
        <div className="shrink-0 border-b border-border">
            <button
                onClick={() => { usedIn.setShowUsedIn(v => !v); if (!usedIn.showUsedIn) usedIn.refetchUsedIn() }}
                className="flex items-center gap-1.5 w-full px-3 py-1 text-[10px] text-muted-foreground hover:text-foreground hover:bg-muted/30 transition-colors"
            >
                {usedIn.showUsedIn ? <ChevronUp size={10} /> : <ChevronDown size={10} />}
                <FileSearch size={10} />
                <span>Used In</span>
                {usedIn.usageData?.processes?.length > 0 && <span className="opacity-60">({usedIn.usageData.processes.length})</span>}
                {usedIn.loadingUsedIn && <Loader2 size={10} className="animate-spin ml-1" />}
            </button>
            {usedIn.showUsedIn && (
                <div className="px-3 py-1.5 bg-muted/10 max-h-48 overflow-auto space-y-2">
                    {!usedIn.usageData && !usedIn.pawBookData && !usedIn.loadingUsedIn && (
                        <p className="text-[10px] text-muted-foreground italic">Scanning…</p>
                    )}
                    {usedIn.usageData && usedIn.usageData.processes.length > 0 && (
                        <div>
                            <div className="text-[10px] uppercase tracking-wider text-muted-foreground/60 font-semibold mb-1">
                                TI Processes ({usedIn.usageData.processes.length})
                            </div>
                            {usedIn.usageData.processes.map((u, i) => (
                                <button key={i}
                                    onClick={() => openTab({ id: processTabId(tab.server, u.process), type: 'process', label: u.process, server: tab.server, name: u.process })}
                                    className="flex items-center gap-1.5 w-full px-1 py-0.5 text-[11px] hover:bg-muted rounded text-left">
                                    <Cog size={10} className="shrink-0 text-muted-foreground" />
                                    <span className="font-mono truncate">{u.process}</span>
                                </button>
                            ))}
                        </div>
                    )}
                    <div>
                        <div className="text-[10px] uppercase tracking-wider text-muted-foreground/60 font-semibold mb-1">
                            PAW Books ({usedIn.pawBookData?.books.length ?? 0})
                        </div>
                        {!usedIn.pawBookData ? (
                            <p className="text-[10px] text-muted-foreground italic">Scanning…</p>
                        ) : usedIn.pawBookData.books.length === 0 ? (
                            <p className="text-[10px] text-muted-foreground italic">None found.</p>
                        ) : (
                            <div className="space-y-0.5">
                                {usedIn.pawBookData.books.map(book => (
                                    <a key={book.id}
                                        href={`${usedIn.pawBookData?.pawHost || ''}/ui?type=book&path=${encodeURIComponent(book.path)}`}
                                        target="_blank" rel="noreferrer"
                                        className="flex items-center gap-1.5 text-[10px] hover:bg-muted rounded px-1 py-0.5"
                                        title={book.path}>
                                        <BookOpen size={9} className="shrink-0 text-muted-foreground" />
                                        <span className="truncate">{book.name}</span>
                                    </a>
                                ))}
                            </div>
                        )}
                    </div>
                </div>
            )}
        </div>
    )
}
