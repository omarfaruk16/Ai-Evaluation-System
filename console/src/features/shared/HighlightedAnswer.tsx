import type { Highlight } from '@/lib/types';
import { cn } from '@/lib/utils';

/** The answer text with the model's strength/weakness quotes marked. Offsets are UTF-16 into `text`. */
export function HighlightedAnswer({ text, highlights, className }: { text: string; highlights: Highlight[]; className?: string }) {
  const sorted = [...highlights].filter((h) => h.start >= 0 && h.end <= text.length && h.end > h.start).sort((a, b) => a.start - b.start);
  const parts: { text: string; h?: Highlight }[] = [];
  let at = 0;
  for (const h of sorted) {
    if (h.start < at) continue;
    if (h.start > at) parts.push({ text: text.slice(at, h.start) });
    parts.push({ text: text.slice(h.start, h.end), h });
    at = h.end;
  }
  if (at < text.length) parts.push({ text: text.slice(at) });
  return (
    <p className={cn('text-[13.5px] leading-7 whitespace-pre-wrap', className)}>
      {parts.map((p, i) =>
        p.h ? (
          <mark
            key={i}
            title={`${p.h.criterionId ? `${p.h.criterionId}: ` : ''}${p.h.note}`}
            className={cn(
              'rounded-sm px-0.5 text-foreground underline decoration-2 underline-offset-[5px]',
              p.h.kind === 'strength' ? 'bg-success-soft decoration-success' : 'bg-warning-soft decoration-warning decoration-wavy',
            )}
          >
            {p.text}
          </mark>
        ) : (
          <span key={i}>{p.text}</span>
        ),
      )}
    </p>
  );
}

export function HighlightLegend() {
  return (
    <div className="text-muted flex gap-4 text-xs">
      <span className="flex items-center gap-1.5">
        <span className="bg-success-soft border-success inline-block h-3 w-4 rounded-sm border-b-2" /> Earned marks
      </span>
      <span className="flex items-center gap-1.5">
        <span className="bg-warning-soft border-warning inline-block h-3 w-4 rounded-sm border-b-2 border-dashed" /> Wrong or weak
      </span>
    </div>
  );
}
