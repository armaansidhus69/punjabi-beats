/**
 * Democratic Queue Voting Engine (Phase 11 Jam)
 *
 * Implements upvoting, downvoting, democratic re-ordering,
 * and score calculations for group listening rooms.
 * Pure logic — headless & zero external dependencies.
 */

export type VoteValue = 1 | -1 | 0;

export interface VoteResult {
  vote: VoteValue;
  deltaUp: number;
  deltaDown: number;
}

/**
 * Calculates net democratic score: upVotes - downVotes
 */
export function calculateQueueScore(upVotes: number, downVotes: number): number {
  return (Number.isFinite(upVotes) ? upVotes : 0) - (Number.isFinite(downVotes) ? downVotes : 0);
}

/**
 * Toggles or applies a vote change and computes the deltas to apply to item tallies.
 */
export function applyVote(currentVote: VoteValue, targetVote: VoteValue): VoteResult {
  // Clicking the same active vote toggles it off back to 0
  const finalVote: VoteValue = currentVote === targetVote ? 0 : targetVote;

  let deltaUp = 0;
  let deltaDown = 0;

  if (currentVote === 1) deltaUp -= 1;
  if (currentVote === -1) deltaDown -= 1;

  if (finalVote === 1) deltaUp += 1;
  if (finalVote === -1) deltaDown += 1;

  return {
    vote: finalVote,
    deltaUp,
    deltaDown,
  };
}

export interface VotableQueueItem {
  id: string;
  score: number;
  createdAt: number;
  isCurrent?: boolean;
}

/**
 * Sorts queue by democratic score (descending), preserving current playing song at index 0.
 * Tiebreaker: earliest added (createdAt ascending).
 */
export function sortQueueByVotes<T extends VotableQueueItem>(items: T[]): T[] {
  const current = items.filter((item) => item.isCurrent);
  const remaining = items.filter((item) => !item.isCurrent);

  remaining.sort((a, b) => {
    if (b.score !== a.score) {
      return b.score - a.score;
    }
    return a.createdAt - b.createdAt;
  });

  return [...current, ...remaining];
}

/**
 * Formats score with sign (e.g., "+3", "-1", "0")
 */
export function formatScore(score: number): string {
  if (score > 0) return `+${score}`;
  return String(score);
}

