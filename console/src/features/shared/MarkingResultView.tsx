import { CheckCircle2, CircleAlert } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Table, Td, TdNum, Th, THead, Tr } from '@/components/ui/table';
import { fmtNum } from '@/lib/format';
import type { MarkingResult } from '@/lib/types';
import { HighlightedAnswer, HighlightLegend } from './HighlightedAnswer';

const FLAG_LABEL: Record<string, string> = {
  blank: 'Blank answer',
  too_long: 'Too long for AI',
  off_topic: 'Off topic',
  injection_attempt: 'Tries to instruct the marker',
  language_mismatch: 'Hard-to-read language',
  incomplete_output: 'Model skipped a criterion',
};

export function ScoreBlock({ score, max, confidence, flags }: { score: number | null; max: number; confidence: number | null; flags: string[] }) {
  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
      <div className="tabular text-3xl font-semibold tracking-tight">
        {score === null ? '—' : fmtNum(score, 1)}
        <span className="text-muted text-lg font-normal"> / {fmtNum(max, 1)}</span>
      </div>
      {confidence !== null && (
        <Badge tone={confidence >= 0.75 ? 'success' : confidence >= 0.5 ? 'neutral' : 'warning'}>Confidence {confidence.toFixed(2)}</Badge>
      )}
      {flags.map((f) => (
        <Badge key={f} tone="warning">
          <CircleAlert /> {FLAG_LABEL[f] ?? f}
        </Badge>
      ))}
    </div>
  );
}

function PointList({ title, items, tone }: { title: string; items: string[]; tone: 'success' | 'warning' }) {
  if (items.length === 0) return null;
  return (
    <div>
      <p className={`mb-1.5 text-xs font-semibold tracking-wide uppercase ${tone === 'success' ? 'text-success' : 'text-warning'}`}>{title}</p>
      <ul className="space-y-1 text-[13px] leading-relaxed">
        {items.map((t, i) => (
          <li key={i} className="flex gap-2">
            {tone === 'success' ? <CheckCircle2 className="text-success mt-0.5 size-3.5 shrink-0" /> : <CircleAlert className="text-warning mt-0.5 size-3.5 shrink-0" />}
            <span>{t}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Everything a teacher would see for one marked answer. */
export function MarkingResultView({ result, answer, maxMarks }: { result: MarkingResult; answer: string; maxMarks: number }) {
  return (
    <div className="space-y-5">
      <ScoreBlock score={result.suggestedScore} max={maxMarks} confidence={result.confidence} flags={result.flags} />
      {result.summary && <p className="bg-surface-2 rounded-lg px-4 py-3 text-[13.5px] leading-relaxed">{result.summary}</p>}

      <div className="rounded-lg border p-4">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <p className="text-muted text-xs font-medium">Student answer</p>
          {result.highlights.length > 0 && <HighlightLegend />}
        </div>
        {answer ? <HighlightedAnswer text={answer} highlights={result.highlights} /> : <p className="text-muted text-sm italic">(blank)</p>}
      </div>

      <div className="overflow-hidden rounded-lg border">
        <Table>
          <THead>
            <tr>
              <Th>Criterion</Th>
              <Th>Why</Th>
              <Th className="text-right">Marks</Th>
            </tr>
          </THead>
          <tbody>
            {result.criteria.map((c) => (
              <Tr key={c.id}>
                <Td className="max-w-[220px]">
                  <span className="text-muted mr-1.5 font-mono text-xs">{c.id}</span>
                  {c.criterion}
                </Td>
                <Td className="text-muted text-[13px]" data-block>
                  {c.reason}
                </Td>
                <TdNum className={`max-sm:-order-1 ${c.awarded >= c.max ? 'text-success font-medium' : c.awarded === 0 ? 'text-danger' : ''}`}>
                  {fmtNum(c.awarded, 1)} / {fmtNum(c.max, 1)}
                </TdNum>
              </Tr>
            ))}
          </tbody>
        </Table>
      </div>

      {(result.strengths.length > 0 || result.weaknesses.length > 0 || result.missing.length > 0) && (
        <div className="grid gap-5 sm:grid-cols-2">
          <PointList title="Strong points" items={result.strengths} tone="success" />
          <PointList
            title="Weak points"
            items={[...result.weaknesses, ...result.missing.map((m) => `Missing: ${m.note}${m.criterionId ? ` (${m.criterionId})` : ''}`)]}
            tone="warning"
          />
        </div>
      )}

    </div>
  );
}
