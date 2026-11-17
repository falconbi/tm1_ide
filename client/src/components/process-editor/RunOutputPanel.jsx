import { cn } from '@/lib/utils'
import { CheckCircle2, XCircle, AlertCircle, ChevronDown, ChevronRight, Loader2, X } from 'lucide-react'

// The run result bar, the __RUN_LOG output and the TM1 error log behind the
// Error Log button.
export default function RunOutputPanel({
  runOutput, onJumpToError,
  errorLogFilename, errorLogOpen, onErrorLogClick,
  logOpen, onToggleLog, logContent,
  errorLogLoading, errorLogContent, onClose,
}) {
  return (
    <div className={cn(
      'shrink-0 border-t border-border',
      runOutput.status === 'error' ? 'bg-red-950/20' : 'bg-green-950/10'
    )}>
      {/* Status bar */}
      <div className="flex items-center gap-3 px-4 py-1.5 text-xs">
        {runOutput.status === 'ok' ? (
          <>
            <CheckCircle2 size={13} className="text-green-500 shrink-0" />
            <span className="text-green-400">
              Completed{runOutput.duration != null ? ` — ${runOutput.duration}ms` : ''}
            </span>
          </>
        ) : (
          <>
            <XCircle size={13} className="text-red-400 shrink-0" />
            <span className="text-red-300 font-mono truncate flex-1">{runOutput.message}</span>
            {runOutput.section && runOutput.line && (
              <button
                onClick={() => onJumpToError(runOutput.section, runOutput.line)}
                className="shrink-0 text-red-300 hover:text-red-100 underline underline-offset-2"
              >
                → {runOutput.section} line {runOutput.line}
              </button>
            )}
          </>
        )}
        <div className="ml-auto flex items-center gap-2 shrink-0">
          {errorLogFilename && (
            <button
              onClick={onErrorLogClick}
              className={cn(
                'flex items-center gap-1 text-xs transition-colors',
                errorLogOpen ? 'text-amber-400 hover:text-amber-300' : 'text-amber-500 hover:text-amber-400'
              )}
              title={`View TM1 error log: ${errorLogFilename}`}
            >
              <AlertCircle size={11} />
              Error Log
            </button>
          )}
          <button
            onClick={onToggleLog}
            className="flex items-center gap-1 text-muted-foreground hover:text-foreground transition-colors"
            title="Toggle run log output"
          >
            {logOpen ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
            <span>Log</span>
          </button>
          <button
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground"
          >
            <X size={11} />
          </button>
        </div>
      </div>

      {/* __RUN_LOG content */}
      {logOpen && (
        <div className="border-t border-border/50 max-h-52 overflow-auto px-4 py-2">
          {logContent === null ? (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Loader2 size={11} className="animate-spin" /> Running…
            </div>
          ) : logContent === '' ? (
            <p className="text-xs text-muted-foreground italic">No log output. Use AttrPutS to write to __RUN_LOG in your TI.</p>
          ) : (
            <pre className="text-xs font-mono text-foreground/80 whitespace-pre-wrap leading-relaxed">{logContent}</pre>
          )}
        </div>
      )}

      {/* TM1 Error Log file content */}
      {errorLogOpen && (
        <div className="border-t border-amber-900/40 bg-amber-950/10 max-h-64 overflow-auto px-4 py-2">
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-[10px] font-mono text-amber-500/70 truncate">{errorLogFilename}</span>
          </div>
          {errorLogLoading ? (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Loader2 size={11} className="animate-spin" /> Loading…
            </div>
          ) : (
            <pre className="text-xs font-mono text-amber-200/80 whitespace-pre-wrap leading-relaxed">{errorLogContent ?? ''}</pre>
          )}
        </div>
      )}
    </div>
  )
}
