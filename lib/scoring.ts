import type { Card } from "./constants";
import { getCardRank } from "./card";

/**
 * Calculate penalty score for remaining hand.
 *
 * Rules:
 * - Base: cardCount × (-5)
 * - Each "2" rank card in hand: ×2
 * - 7+ cards remaining: ×2
 * - 10+ cards remaining: ×2 more (stacks with 7+)
 * - All multipliers stack multiplicatively
 * - Winner (0 cards) gets 0
 */
export function calculateScore(hand: Card[]): number {
  if (hand.length === 0) return 0;

  let base = hand.length * -5;

  // Count 2s
  const twos = hand.filter((c) => getCardRank(c) === "2").length;

  // Calculate multiplier
  let multiplier = 1;
  if (twos > 0) multiplier *= Math.pow(2, twos);
  if (hand.length >= 7) multiplier *= 2;
  if (hand.length >= 10) multiplier *= 2;

  return base * multiplier;
}

/**
 * Format score breakdown for display
 */
export function scoreBreakdown(hand: Card[]): { base: number; multiplier: number; total: number; reasons: string[] } {
  if (hand.length === 0) return { base: 0, multiplier: 1, total: 0, reasons: ["出完所有牌"] };

  const base = hand.length * -5;
  const twos = hand.filter((c) => getCardRank(c) === "2").length;
  const reasons: string[] = [`${hand.length} 張 × (-5) = ${base}`];

  let multiplier = 1;
  if (twos > 0) {
    multiplier *= Math.pow(2, twos);
    reasons.push(`${twos} 張 2 → ×${Math.pow(2, twos)}`);
  }
  if (hand.length >= 10) {
    multiplier *= 4; // 7+ (×2) and 10+ (×2) = ×4
    reasons.push(`${hand.length} 張 → ×4`);
  } else if (hand.length >= 7) {
    multiplier *= 2;
    reasons.push(`${hand.length} 張 → ×2`);
  }

  return { base, multiplier, total: base * multiplier, reasons };
}
