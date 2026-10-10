import { clamp, roundToStep } from '../common/text';
import { locateHighlights } from './highlights';
import {
  KNOWN_FLAGS,
  type Flag,
  type Highlight,
  type MarkingOutput,
  type MissingPoint,
  type Rubric,
  type ScoredCriterion,
} from './schemas';

export interface MarkingResult {
  suggestedScore: number;
  criteria: ScoredCriterion[];
  summary: string;
  strengths: string[];
  weaknesses: string[];
  highlights: Highlight[];
  missing: MissingPoint[];
  confidence: number;
  flags: Flag[];
}

const cleanList = (items: string[], maxItems: number, maxLen = 300) =>
  items
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, maxItems)
    .map((s) => s.slice(0, maxLen));

/**
 * Scores per criterion from the model's output. The server never trusts a total from the model:
 * each criterion is clamped to its maximum and rounded to the mark step, then summed. A rubric
 * criterion the model skipped scores 0 and lowers confidence.
 */
export function scoreCriteria(
  rubric: Rubric,
  output: Pick<MarkingOutput, 'criteria'>,
  markStep: number,
): { criteria: ScoredCriterion[]; total: number; skipped: string[] } {
  const byId = new Map(output.criteria.map((c) => [c.id.trim(), c]));
  const skipped: string[] = [];
  const criteria = rubric.criteria.map((rc) => {
    const got = byId.get(rc.id);
    if (!got || !Number.isFinite(got.awarded)) skipped.push(rc.id);
    const awarded = got ? roundToStep(clamp(got.awarded, 0, rc.marks), markStep) : 0;
    return {
      id: rc.id,
      criterion: rc.criterion,
      max: rc.marks,
      awarded: clamp(awarded, 0, rc.marks),
      reason: got?.reason.trim().slice(0, 500) ?? 'Not assessed.',
    };
  });
  const total = Number(criteria.reduce((s, c) => s + c.awarded, 0).toFixed(4));
  return { criteria, total, skipped };
}

export function buildMarkingResult(input: {
  rubric: Rubric;
  maxMarks: number;
  markStep: number;
  answer: string;
  output: MarkingOutput;
  maxHighlights: number;
}): MarkingResult {
  const { rubric, maxMarks, markStep, answer, output, maxHighlights } = input;
  const ids = new Set(rubric.criteria.map((c) => c.id));
  const { criteria, total, skipped } = scoreCriteria(rubric, output, markStep);

  const flags = new Set<Flag>(
    output.flags.filter((f): f is Flag => (KNOWN_FLAGS as readonly string[]).includes(f)),
  );
  let confidence = clamp(Number.isFinite(output.confidence) ? output.confidence : 0.5, 0, 1);
  if (skipped.length > 0) {
    flags.add('incomplete_output');
    confidence = Math.min(confidence, 0.3);
  }

  return {
    suggestedScore: clamp(total, 0, maxMarks),
    criteria,
    summary: output.summary.trim().slice(0, 600),
    strengths: cleanList(output.strengths, 6),
    weaknesses: cleanList(output.weaknesses, 6),
    highlights: locateHighlights(answer, output.highlights, ids, maxHighlights),
    missing: output.missing
      .filter((m) => m.note.trim())
      .slice(0, 12)
      .map((m) => ({
        criterionId: ids.has(m.criterion) ? m.criterion : null,
        note: m.note.trim().slice(0, 300),
      })),
    confidence: Number(confidence.toFixed(3)),
    flags: [...flags],
  };
}

/** Result for an empty answer: 0 marks, no LLM call. */
export function blankResult(rubric: Rubric): MarkingResult {
  return {
    suggestedScore: 0,
    criteria: rubric.criteria.map((c) => ({
      id: c.id,
      criterion: c.criterion,
      max: c.marks,
      awarded: 0,
      reason: 'No answer given.',
    })),
    summary: 'No answer was given.',
    strengths: [],
    weaknesses: [],
    highlights: [],
    missing: rubric.criteria.map((c) => ({ criterionId: c.id, note: c.criterion })),
    confidence: 1,
    flags: ['blank'],
  };
}

/** Applies a teacher's per-criterion marks; unknown ids are rejected by the caller. */
export function applyFinalCriteria(
  rubric: Rubric,
  final: { id: string; awarded: number }[],
  markStep: number,
): { criteria: { id: string; awarded: number; max: number }[]; total: number } {
  const byId = new Map(final.map((f) => [f.id, f.awarded]));
  const criteria = rubric.criteria.map((rc) => ({
    id: rc.id,
    max: rc.marks,
    awarded: clamp(roundToStep(byId.get(rc.id) ?? 0, markStep), 0, rc.marks),
  }));
  return { criteria, total: Number(criteria.reduce((s, c) => s + c.awarded, 0).toFixed(4)) };
}
