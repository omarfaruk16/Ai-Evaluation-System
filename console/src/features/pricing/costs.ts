import { estimateAnswerCostUsd, estimateRubricDraftUsd } from '@/lib/billing';
import type { UnitCosts } from '@/lib/types';

export const DEFAULT_ASSUMPTIONS = {
  answerWords: 120,
  tokensPerWord: 1.6,
  questionTokens: 350,
  outputTokens: 450,
  cacheShare: 0,
  overhead: 0.05,
};

/**
 * What one answer costs you: measured from recent traffic when there is enough of it
 * (≥ 50 model-marked answers), otherwise estimated from the marking profile's prices.
 */
export function costBasis(u: UnitCosts | undefined) {
  if (!u) return { perAnswerUsd: null as number | null, perDraftUsd: null as number | null, measured: false };
  const est = estimateAnswerCostUsd(
    {
      ...DEFAULT_ASSUMPTIONS,
      promptBaseTokens: u.promptBaseTokens,
      outputTokens: u.perMarkingCall.outputTokens ?? DEFAULT_ASSUMPTIONS.outputTokens,
    },
    u.markingProfile.prices,
  );
  const measured = u.sample.aiMarked >= 50 && u.costPerAnswerUsd !== null;
  return {
    perAnswerUsd: measured ? u.costPerAnswerUsd : est.perAnswer,
    perDraftUsd: u.sample.rubricDrafts >= 10 && u.costPerRubricDraftUsd !== null ? u.costPerRubricDraftUsd : estimateRubricDraftUsd(u.rubricProfile.prices),
    measured,
  };
}
