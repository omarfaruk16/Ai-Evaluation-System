import { roundToStep, sha256, stableJson } from '../common/text';
import { contains } from './match';
import type { Rubric, RubricDraftOutput } from './schemas';

export interface Issue {
  path: string;
  message: string;
}

const EPS = 1e-6;

const isMultipleOf = (value: number, step: number) =>
  Math.abs(roundToStep(value, step) - value) < EPS;

/** A rubric is usable when ids are unique, marks are multiples of the step and add up to the total. */
export function validateRubric(rubric: Rubric, maxMarks: number, markStep: number): Issue[] {
  const issues: Issue[] = [];
  const seen = new Set<string>();
  rubric.criteria.forEach((c, i) => {
    if (seen.has(c.id)) issues.push({ path: `rubric.criteria.${i}.id`, message: `duplicate id "${c.id}"` });
    seen.add(c.id);
    if (!isMultipleOf(c.marks, markStep)) {
      issues.push({
        path: `rubric.criteria.${i}.marks`,
        message: `${c.marks} is not a multiple of the mark step ${markStep}`,
      });
    }
  });
  const sum = rubric.criteria.reduce((s, c) => s + c.marks, 0);
  if (Math.abs(sum - maxMarks) > EPS) {
    issues.push({
      path: 'rubric.criteria',
      message: `criterion marks add up to ${Number(sum.toFixed(4))}, but maxMarks is ${maxMarks}`,
    });
  }
  if (!isMultipleOf(maxMarks, markStep)) {
    issues.push({ path: 'maxMarks', message: `${maxMarks} is not a multiple of the mark step ${markStep}` });
  }
  return issues;
}

export function rubricHash(rubric: Rubric): string {
  return sha256(
    stableJson(
      rubric.criteria.map((c) => ({
        id: c.id,
        criterion: c.criterion,
        marks: c.marks,
        awardWhen: c.awardWhen,
      })),
    ),
  );
}

export function questionContentHash(q: {
  text: string;
  modelAnswer: string;
  maxMarks: number;
  markStep: number;
  rubric: Rubric;
}): string {
  return sha256(
    stableJson({
      text: q.text.normalize('NFC').trim(),
      modelAnswer: q.modelAnswer.normalize('NFC').trim(),
      maxMarks: q.maxMarks,
      markStep: q.markStep,
      rubric: rubricHash(q.rubric),
    }),
  );
}

/**
 * Checks an AI rubric draft: marks add up and every criterion quotes text that really is in
 * the model answer, so a draft can't invent requirements.
 */
export function validateRubricDraft(
  draft: RubricDraftOutput,
  modelAnswer: string,
  maxMarks: number,
  markStep: number,
  maxCriteria: number,
): Issue[] {
  const issues: Issue[] = [];
  if (draft.criteria.length < 1) issues.push({ path: 'criteria', message: 'no criteria returned' });
  if (draft.criteria.length > maxCriteria) {
    issues.push({ path: 'criteria', message: `more than ${maxCriteria} criteria` });
  }
  draft.criteria.forEach((c, i) => {
    if (!(c.marks > 0)) issues.push({ path: `criteria.${i}.marks`, message: 'marks must be positive' });
    if (!c.criterion.trim()) issues.push({ path: `criteria.${i}.criterion`, message: 'empty label' });
    if (!c.fromModelAnswer.trim() || !contains(modelAnswer, c.fromModelAnswer)) {
      issues.push({
        path: `criteria.${i}.fromModelAnswer`,
        message: `"${c.fromModelAnswer}" is not in the model answer`,
      });
    }
  });
  const asRubric: Rubric = {
    criteria: draft.criteria.map((c, i) => ({
      id: `c${i + 1}`,
      criterion: c.criterion,
      marks: c.marks,
      awardWhen: c.awardWhen,
    })),
  };
  for (const issue of validateRubric(asRubric, maxMarks, markStep)) {
    if (!issue.path.endsWith('.id')) issues.push({ ...issue, path: issue.path.replace(/^rubric\./, '') });
  }
  return issues;
}
