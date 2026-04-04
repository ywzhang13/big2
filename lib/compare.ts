import { Combo } from "./combo";
import { COMBO_POWER } from "./constants";

/**
 * Compare two combos to determine if play2 beats play1.
 *
 * Rules:
 * - Same type: compare by rank, then suit
 * - 鐵支(fourOfAKind) can beat any non-bomb combo of any card count
 * - 同花順(straightFlush) can beat everything including 鐵支
 * - For same-count non-bomb combos: must be same type
 *
 * Returns true if play2 beats play1.
 */
export function beats(play1: Combo, play2: Combo): boolean {
  const power1 = COMBO_POWER[play1.type];
  const power2 = COMBO_POWER[play2.type];

  // 鐵支/同花順 can cross-beat any card count
  if (power2 > 0 && power2 > power1) return true;
  if (power1 > 0 && power1 > power2) return false;

  // Both are bombs of same power: compare rank/suit
  if (power1 > 0 && power2 > 0 && power1 === power2) {
    if (play2.rank > play1.rank) return true;
    if (play2.rank < play1.rank) return false;
    return play2.suit > play1.suit;
  }

  // Non-bomb combos: must match card count and type
  if (play1.cards.length !== play2.cards.length) return false;
  if (play1.type !== play2.type) return false;

  // Same type: compare rank then suit
  if (play2.rank > play1.rank) return true;
  if (play2.rank < play1.rank) return false;
  return play2.suit > play1.suit;
}
