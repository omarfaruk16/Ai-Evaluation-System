import { z } from 'zod';
import type { Env } from '../config/env';
import { criterionIdSchema, rubricSchema } from '../marking/schemas';

const id = z.string().trim().min(1).max(200);

const callbackUrl = (env: Env) =>
  z
    .string()
    .url()
    .max(2_000)
    .refine((u) => (env.NODE_ENV === 'production' ? u.startsWith('https://') : /^https?:\/\//.test(u)), {
      message: 'callbackUrl must be an https:// URL',
    });

export const submitEvaluationsSchema = (env: Env) =>
  z.object({
    groupId: id.optional(),
    lane: z.enum(['auto', 'realtime', 'deferred']).default('auto'),
    callbackUrl: callbackUrl(env).optional(),
    question: z.object({
      externalId: id.optional(),
      text: z.string().trim().min(1).max(20_000),
      modelAnswer: z.string().trim().min(1).max(20_000),
      maxMarks: z.number().positive().max(1_000),
      markStep: z.number().positive().max(100).default(0.5),
      rubric: rubricSchema,
    }),
    answers: z
      .array(z.object({ externalId: id, text: z.string().max(200_000) }))
      .min(1)
      .max(env.MAX_ANSWERS_PER_REQUEST),
  });
export type SubmitEvaluationsDto = z.infer<ReturnType<typeof submitEvaluationsSchema>>;

export const listEvaluationsSchema = z.object({
  groupId: id.optional(),
  questionId: z.string().uuid().optional(),
  externalId: id.optional(),
  status: z.enum(['queued', 'running', 'completed', 'failed']).optional(),
  updatedSince: z.string().datetime({ offset: true }).optional(),
  cursor: z.string().max(500).optional(),
  limit: z.coerce.number().int().min(1).max(500).default(100),
});
export type ListEvaluationsDto = z.infer<typeof listEvaluationsSchema>;

export const reviewSchema = z
  .object({
    decision: z.enum(['accepted', 'adjusted', 'rejected']),
    finalCriteria: z.array(z.object({ id: criterionIdSchema, awarded: z.number().min(0) })).optional(),
    teacherNote: z.string().trim().max(2_000).optional(),
  })
  .refine((v) => v.decision !== 'adjusted' || (v.finalCriteria?.length ?? 0) > 0, {
    message: 'finalCriteria is required when decision is "adjusted"',
    path: ['finalCriteria'],
  });
export type ReviewDto = z.infer<typeof reviewSchema>;

export const rubricDraftSchema = z.object({
  question: z.string().trim().min(1).max(20_000),
  modelAnswer: z.string().trim().min(1).max(20_000),
  maxMarks: z.number().positive().max(1_000),
  markStep: z.number().positive().max(100).default(0.5),
  maxCriteria: z.number().int().min(1).max(12).default(6),
});

/** One answer marked straight away (nothing stored), to check a rubric before an exam uses it. */
export const tryMarkSchema = z.object({
  question: z.string().trim().min(1).max(20_000),
  modelAnswer: z.string().trim().min(1).max(20_000),
  maxMarks: z.number().positive().max(1_000),
  markStep: z.number().positive().max(100).default(0.5),
  rubric: rubricSchema,
  answer: z.string().max(20_000),
});

export const usageQuerySchema = z.object({
  from: z.string().datetime({ offset: true }).optional(),
  to: z.string().datetime({ offset: true }).optional(),
});
