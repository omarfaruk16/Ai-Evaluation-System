import type { Lane } from '@prisma/client';

export type RequestedLane = 'auto' | 'realtime' | 'deferred';

export interface LaneInput {
  requested: RequestedLane;
  /** How many answers to this question were submitted before this one (0-based). */
  positionInQuestion: number;
  /** Total answers in the group (exam) so far, including this request. */
  groupSize: number;
  /** Jobs currently waiting in the realtime queue. */
  realtimeWaiting: number;
}

export interface LaneConfig {
  firstNRealtime: number;
  smallGroupMax: number;
  realtimeMaxWaiting: number;
}

/**
 * Realtime for small groups and for the first answers of each question (so a teacher can start
 * marking at once); everything else goes to the deferred lane. When the realtime queue is backed
 * up, new automatic work goes deferred too. An explicit lane from the client is honoured.
 */
export function chooseLane(input: LaneInput, cfg: LaneConfig): Lane {
  if (input.requested !== 'auto') return input.requested;
  if (input.realtimeWaiting >= cfg.realtimeMaxWaiting) return 'deferred';
  if (input.groupSize <= cfg.smallGroupMax) return 'realtime';
  if (input.positionInQuestion < cfg.firstNRealtime) return 'realtime';
  return 'deferred';
}
