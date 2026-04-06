import { Combo, detectCombo } from "./combo";
import { COMBO_POWER } from "./constants";

/**
 * Ensure combo has valid data — always re-detect from cards for safety.
 * JSON serialization through Supabase broadcast can corrupt type/rank/suit.
 */
function ensureCombo(combo: Combo): Combo {
  if (combo?.cards?.length > 0) {
    const redetected = detectCombo(combo.cards);
    if (redetected) return redetected;
  }
  return combo;
}

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
  // Re-validate combos in case JSON serialization corrupted type info
  const c1 = ensureCombo(play1);
  const c2 = ensureCombo(play2);
  const power1 = COMBO_POWER[c1.type] ?? 0;
  const power2 = COMBO_POWER[c2.type] ?? 0;

  // 鐵支/同花順 can cross-beat any card count
  if (power2 > 0 && power2 > power1) return true;
  if (power1 > 0 && power1 > power2) return false;

  // Both are bombs of same power: compare rank/suit
  if (power1 > 0 && power2 > 0 && power1 === power2) {
    if (c2.rank > c1.rank) return true;
    if (c2.rank < c1.rank) return false;
    return c2.suit > c1.suit;
  }

  // Non-bomb combos: must match card count and type
  if (c1.cards.length !== c2.cards.length) return false;
  if (c1.type !== c2.type) return false;

  // Same type: compare rank then suit
  if (c2.rank > c1.rank) return true;
  if (c2.rank < c1.rank) return false;
  return c2.suit > c1.suit;
}
