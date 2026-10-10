import { z } from 'zod';

// ───────────────────────── Rubric (sent by clients, stored per question) ─────────────────────────

export const criterionIdSchema = z
  .string()
  .regex(/^[A-Za-z0-9_-]{1,32}$/, 'use letters, digits, "-" or "_" (max 32 characters)');

export const rubricCriterionSchema = z.object({
  id: criterionIdSchema,
  criterion: z.string().trim().min(1).max(300),
  marks: z.number().positive().max(1000),
  awardWhen: z.string().trim().max(1000).default(''),
});

export const rubricSchema = z.object({
  criteria: z.array(rubricCriterionSchema).min(1).max(12),
});

export type Rubric = z.infer<typeof rubricSchema>;
export type RubricCriterion = Rubric['criteria'][number];

// ───────────────────────── Stored / returned result shapes ─────────────────────────

export const KNOWN_FLAGS = [
  'blank',
  'too_long',
  'off_topic',
  'injection_attempt',
  'language_mismatch',
  'incomplete_output',
] as const;
export type Flag = (typeof KNOWN_FLAGS)[number];

export interface ScoredCriterion {
  id: string;
  criterion: string;
  max: number;
  awarded: number;
  reason: string;
}

export interface Highlight {
  start: number;
  end: number;
  quote: string;
  kind: 'strength' | 'weakness';
  criterionId: string | null;
  note: string;
}

export interface MissingPoint {
  criterionId: string | null;
  note: string;
}

export interface StudentFeedback {
  didWell: string[];
  toImprove: string[];
}

// ───────────────────────── LLM outputs (validated after JSON.parse) ─────────────────────────

export const markingOutputSchema = z.object({
  criteria: z.array(z.object({ id: z.string(), awarded: z.number(), reason: z.string() })),
  summary: z.string(),
  strengths: z.array(z.string()),
  weaknesses: z.array(z.string()),
  highlights: z.array(
    z.object({
      quote: z.string(),
      kind: z.enum(['strength', 'weakness']),
      criterion: z.string().nullable(),
      note: z.string(),
    }),
  ),
  missing: z.array(z.object({ criterion: z.string(), note: z.string() })),
  studentFeedback: z.object({ didWell: z.array(z.string()), toImprove: z.array(z.string()) }),
  confidence: z.number(),
  flags: z.array(z.string()),
});
export type MarkingOutput = z.infer<typeof markingOutputSchema>;

export const rubricDraftOutputSchema = z.object({
  criteria: z.array(
    z.object({
      id: z.string(),
      criterion: z.string(),
      marks: z.number(),
      awardWhen: z.string(),
      fromModelAnswer: z.string(),
    }),
  ),
  notes: z.string(),
});
export type RubricDraftOutput = z.infer<typeof rubricDraftOutputSchema>;

export const feedbackOutputSchema = z.object({
  didWell: z.array(z.string()),
  toImprove: z.array(z.string()),
});
export type FeedbackOutput = z.infer<typeof feedbackOutputSchema>;

// ───────────────────────── JSON Schemas for strict structured output ─────────────────────────
// Strict mode needs every property listed in `required` and additionalProperties: false.

const str = { type: 'string' } as const;
const strArr = { type: 'array', items: str } as const;
const obj = (properties: Record<string, unknown>) => ({
  type: 'object',
  additionalProperties: false,
  required: Object.keys(properties),
  properties,
});

export const markingJsonSchema = obj({
  criteria: {
    type: 'array',
    items: obj({ id: str, awarded: { type: 'number' }, reason: str }),
  },
  summary: str,
  strengths: strArr,
  weaknesses: strArr,
  highlights: {
    type: 'array',
    items: obj({
      quote: str,
      kind: { type: 'string', enum: ['strength', 'weakness'] },
      criterion: { type: ['string', 'null'] },
      note: str,
    }),
  },
  missing: { type: 'array', items: obj({ criterion: str, note: str }) },
  studentFeedback: obj({ didWell: strArr, toImprove: strArr }),
  confidence: { type: 'number' },
  flags: {
    type: 'array',
    items: { type: 'string', enum: ['off_topic', 'injection_attempt', 'language_mismatch'] },
  },
});

export const rubricDraftJsonSchema = obj({
  criteria: {
    type: 'array',
    items: obj({
      id: str,
      criterion: str,
      marks: { type: 'number' },
      awardWhen: str,
      fromModelAnswer: str,
    }),
  },
  notes: str,
});

export const feedbackJsonSchema = obj({ didWell: strArr, toImprove: strArr });
