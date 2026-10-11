import { fmtInt, fmtMs, fmtCost } from '@/lib/format';
import type { MarkResponse } from '@/lib/types';

/** Model, host, tokens, cost and time of one call. */
export function CallStrip({ r }: { r: Partial<MarkResponse> & { model?: string } }) {
  if (!r.usage) return null;
  return (
    <div className="bg-surface-2/70 flex flex-wrap gap-x-6 gap-y-2 rounded-lg px-3 py-3 sm:px-4 text-[13px]">
      <span>
        <span className="text-muted">Model </span>
        <span className="font-mono text-xs break-all">{r.model}</span>
      </span>
      <span>
        <span className="text-muted">Host </span>
        {r.host ?? '—'}
      </span>
      <span>
        <span className="text-muted">Tokens </span>
        <span className="tabular">
          {fmtInt(r.usage.inputTokens)} in{r.usage.cachedTokens ? ` (${fmtInt(r.usage.cachedTokens)} cached)` : ''} · {fmtInt(r.usage.outputTokens)} out
        </span>
      </span>
      <span>
        <span className="text-muted">Cost </span>
        <span className="tabular font-medium">{fmtCost(r.usage.costUsd)}</span>
        {r.costEstimated && <span className="text-muted"> (estimated)</span>}
      </span>
      <span>
        <span className="text-muted">Time </span>
        <span className="tabular">{fmtMs(r.latencyMs)}</span>
      </span>
    </div>
  );
}
