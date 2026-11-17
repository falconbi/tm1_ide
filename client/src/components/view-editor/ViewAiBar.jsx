import { Loader2, Sparkles } from 'lucide-react'
import { cn } from '@/lib/utils'

export default function ViewAiBar({ hasAI, aiPrompt, setAiPrompt, handleGenerateAI, generateViewMDX }) {
    return (
        <div className="flex items-center gap-2 px-3 py-1.5 border-b border-border bg-muted/10 shrink-0">
            <Sparkles size={11} className={cn('shrink-0', hasAI ? 'text-violet-400' : 'text-muted-foreground/40')} />
            {hasAI ? (
                <>
                    <input value={aiPrompt} onChange={e => setAiPrompt(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleGenerateAI()}
                        placeholder="Describe the view you want…"
                        className="flex-1 text-xs bg-transparent outline-none placeholder:text-muted-foreground/40" />
                    <button onClick={handleGenerateAI} disabled={!aiPrompt.trim() || generateViewMDX.isPending}
                        className="flex items-center gap-1 px-2 py-0.5 text-xs rounded bg-violet-700 text-white disabled:opacity-40 hover:bg-violet-600 transition-colors shrink-0">
                        {generateViewMDX.isPending ? <Loader2 size={10} className="animate-spin" /> : <Sparkles size={10} />} Generate
                    </button>
                </>
            ) : (
                <span className="flex-1 text-xs text-muted-foreground/40 italic">AI not configured — set AI_PROVIDER in .env</span>
            )}
        </div>
    )
}
