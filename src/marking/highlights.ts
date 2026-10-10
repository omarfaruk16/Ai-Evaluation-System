import { locate, type Span } from './match';
import type { Highlight } from './schemas';

export interface RawHighlight {
  quote: string;
  kind: 'strength' | 'weakness';
  criterion: string | null;
  note: string;
}

const MATH = /\$\$[\s\S]+?\$\$|\$[^$\n]+?\$|\\\([\s\S]+?\\\)|\\\[[\s\S]+?\\\]/g;

/** Widen a span that cuts into a LaTeX formula so the formula still renders as a whole. */
function expandToMath(text: string, span: Span): Span {
  let { start, end } = span;
  for (const m of text.matchAll(MATH)) {
    const s = m.index ?? 0;
    const e = s + m[0].length;
    if (start > s && start < e) start = s;
    if (end > s && end < e) end = e;
  }
  return { start, end };
}

const overlaps = (a: Span, b: Span) => a.start < b.end && b.start < a.end;

/**
 * Turns the model's quoted highlights into positioned spans on the answer text. Quotes that
 * can't be found are dropped. Overlaps keep the weakness (wrong statements matter most to a
 * marker), otherwise the longer span. At most `max` highlights are kept.
 */
export function locateHighlights(
  answer: string,
  raw: RawHighlight[],
  criterionIds: Set<string>,
  max: number,
): Highlight[] {
  const placed: Highlight[] = [];

  for (const h of raw) {
    if (!h.quote || !h.quote.trim()) continue;
    let from = 0;
    let span: Span | null = null;
    // A repeated quote ("the network") goes to its next unused occurrence.
    for (;;) {
      const found = locate(answer, h.quote, from);
      if (!found) break;
      if (!placed.some((p) => p.start === found.start && p.end === found.end)) {
        span = found;
        break;
      }
      from = found.end;
    }
    if (!span) continue;
    const widened = expandToMath(answer, span);
    placed.push({
      start: widened.start,
      end: widened.end,
      quote: answer.slice(widened.start, widened.end),
      kind: h.kind,
      criterionId: h.criterion && criterionIds.has(h.criterion) ? h.criterion : null,
      note: h.note.trim().slice(0, 300),
    });
  }

  placed.sort((a, b) => a.start - b.start || b.end - a.end);
  const kept: Highlight[] = [];
  for (const h of placed) {
    const clash = kept.findIndex((k) => overlaps(k, h));
    if (clash < 0) {
      kept.push(h);
      continue;
    }
    const other = kept[clash]!;
    const hWins =
      (h.kind === 'weakness' && other.kind === 'strength') ||
      (h.kind === other.kind && h.end - h.start > other.end - other.start);
    if (hWins && !kept.some((k, i) => i !== clash && overlaps(k, h))) kept[clash] = h;
  }

  if (kept.length > max) {
    const ranked = [...kept].sort(
      (a, b) =>
        (a.kind === 'weakness' ? 0 : 1) - (b.kind === 'weakness' ? 0 : 1) ||
        b.end - b.start - (a.end - a.start),
    );
    return ranked.slice(0, max).sort((a, b) => a.start - b.start);
  }
  return kept.sort((a, b) => a.start - b.start);
}
