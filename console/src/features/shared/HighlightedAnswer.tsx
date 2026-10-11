import { useState } from 'react';
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
  // Tap (or focus) a highlight to read the model's note: hover tooltips don't exist on touch screens.
  const [active, setActive] = useState<number | null>(null);
  const note = active !== null ? parts[active]?.h : undefined;
  return (
    <div>
      <p className={cn('text-[13.5px] leading-7 whitespace-pre-wrap', className)}>
        {parts.map((p, i) =>
          p.h ? (
            <mark
              key={i}
              role="button"
              tabIndex={0}
              aria-pressed={active === i}
              title={`${p.h.criterionId ? `${p.h.criterionId}: ` : ''}${p.h.note}`}
              onClick={() => setActive((a) => (a === i ? null : i))}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  setActive((a) => (a === i ? null : i));
                }
              }}
              className={cn(
                'text-foreground cursor-pointer rounded-sm px-0.5 underline decoration-2 underline-offset-[5px] transition-shadow',
                p.h.kind === 'strength' ? 'bg-success-soft decoration-success' : 'bg-warning-soft decoration-warning decoration-wavy',
                active === i && 'ring-primary/50 ring-2',
              )}
            >
              {p.text}
            </mark>
          ) : (
            <span key={i}>{p.text}</span>
          ),
        )}
      </p>
      {note && (
        <div
          key={active}
          role="status"
          className={cn(
            'animate-fade-up mt-2 flex items-start gap-2 rounded-lg border px-3 py-2 text-[13px]',
            note.kind === 'strength' ? 'border-success/30 bg-success-soft' : 'border-warning/30 bg-warning-soft',
          )}
        >
          <span className={cn('mt-1.5 size-2 shrink-0 rounded-full', note.kind === 'strength' ? 'bg-success' : 'bg-warning')} />
          <p className="min-w-0 flex-1">
            {note.criterionId && <span className="text-muted mr-1.5 font-mono text-xs">{note.criterionId}</span>}
            {note.note}
          </p>
          <button type="button" onClick={() => setActive(null)} className="text-muted hover:text-foreground -my-1 -mr-1 rounded p-1" aria-label="Close note">
            ×
          </button>
        </div>
      )}
    </div>
  );
}

export function HighlightLegend() {
  return (
    <div className="text-muted flex flex-wrap gap-x-4 gap-y-1 text-xs">
      <span className="flex items-center gap-1.5">
        <span className="bg-success-soft border-success inline-block h-3 w-4 rounded-sm border-b-2" /> Earned marks
      </span>
      <span className="flex items-center gap-1.5">
        <span className="bg-warning-soft border-warning inline-block h-3 w-4 rounded-sm border-b-2 border-dashed" /> Wrong or weak
      </span>
      <span className="pointer-coarse:inline hidden">Tap a highlight for the reason</span>
    </div>
  );
}
