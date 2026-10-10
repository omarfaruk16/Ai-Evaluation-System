// Finds a quoted fragment inside a text, tolerating differences in case, spacing, curly quotes
// and dashes. Positions are returned as UTF-16 offsets into the original text.

const CHAR_MAP: Record<string, string> = {
  '‘': "'",
  '’': "'",
  '‚': "'",
  '“': '"',
  '”': '"',
  '„': '"',
  '–': '-',
  '—': '-',
  '−': '-',
  ' ': ' ',
};

interface Folded {
  text: string;
  /** For each code unit of `text`: the offset of the source character it came from. */
  start: number[];
  /** For each code unit of `text`: the end offset (exclusive) of that source character. */
  end: number[];
}

function fold(source: string): Folded {
  const out: string[] = [];
  const start: number[] = [];
  const end: number[] = [];
  let offset = 0;
  let pendingSpace = false;

  for (const ch of source) {
    const from = offset;
    offset += ch.length;
    const mapped = CHAR_MAP[ch] ?? ch;
    if (/\s/u.test(mapped)) {
      pendingSpace = out.length > 0;
      continue;
    }
    if (pendingSpace) {
      out.push(' ');
      start.push(from);
      end.push(from);
      pendingSpace = false;
    }
    for (const unit of mapped.toLowerCase()) {
      for (let i = 0; i < unit.length; i++) {
        out.push(unit[i]!);
        start.push(from);
        end.push(offset);
      }
    }
  }
  return { text: out.join(''), start, end };
}

/** Strip surrounding whitespace, quotes and sentence punctuation the model may add around a quote. */
function trimEdges(s: string): string {
  return s.replace(/^[\s"'“”‘’«».,;:!?…\-–—()[\]]+|[\s"'“”‘’«».,;:!?…\-–—()[\]]+$/gu, '');
}

export interface Span {
  start: number;
  end: number;
}

/**
 * Locate `needle` in `haystack` at or after offset `from`. Tries an exact match first, then a
 * folded match (case, whitespace, punctuation variants). Returns null when not found; callers
 * drop such quotes rather than guess.
 */
export function locate(haystack: string, needle: string, from = 0): Span | null {
  const n = needle.normalize('NFC');
  if (n.trim().length === 0) return null;

  const exact = haystack.indexOf(n, from);
  if (exact >= 0) return { start: exact, end: exact + n.length };

  const trimmed = trimEdges(n);
  if (trimmed.length >= 2) {
    const exactTrimmed = haystack.indexOf(trimmed, from);
    if (exactTrimmed >= 0) return { start: exactTrimmed, end: exactTrimmed + trimmed.length };
  }

  const fn = fold(trimmed).text;
  if (fn.length < 2) return null;
  const fh = fold(haystack);
  let k = 0;
  while (k < fh.start.length && fh.start[k]! < from) k++;
  const idx = fh.text.indexOf(fn, k);
  if (idx < 0) return null;
  return { start: fh.start[idx]!, end: fh.end[idx + fn.length - 1]! };
}

/** True when `needle` appears in `haystack` (exact or folded). */
export function contains(haystack: string, needle: string): boolean {
  return locate(haystack, needle) !== null;
}
