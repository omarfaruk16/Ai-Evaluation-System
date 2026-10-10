import type { Evaluation } from '@prisma/client';

/** The public JSON shape of an evaluation: API responses and webhook payloads use it. */
export function toView(ev: Evaluation) {
  return {
    id: ev.id,
    externalId: ev.externalId,
    groupId: ev.groupId,
    questionId: ev.questionId,
    status: ev.status,
    lane: ev.lane,
    maxMarks: ev.maxMarks,
    suggestedScore: ev.suggestedScore,
    criteria: ev.criteria ?? [],
    summary: ev.summary,
    strengths: ev.strengths,
    weaknesses: ev.weaknesses,
    highlights: ev.highlights ?? [],
    missing: ev.missing ?? [],
    studentFeedback: ev.studentFeedback,
    confidence: ev.confidence,
    flags: ev.flags,
    // Highlight offsets refer to this exact text (NFC-normalised, trimmed).
    answerText: ev.answerText,
    model: ev.model,
    host: ev.host,
    promptVersion: ev.promptVersion,
    reusedFromId: ev.reusedFromId,
    error: ev.error,
    review: ev.decision
      ? {
          decision: ev.decision,
          finalScore: ev.finalScore,
          finalCriteria: ev.finalCriteria,
          finalFeedback: ev.finalFeedback,
          reviewedAt: ev.reviewedAt?.toISOString() ?? null,
        }
      : null,
    createdAt: ev.createdAt.toISOString(),
    updatedAt: ev.updatedAt.toISOString(),
    completedAt: ev.completedAt?.toISOString() ?? null,
  };
}

export type EvaluationView = ReturnType<typeof toView>;
