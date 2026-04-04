import { Combo } from "./combo";
import { COMBO_POWER } from "./constants";

/**
 * Compare two combos to determine if play2 beats play1.
 *
 * Rules:
 * - Must be same card count (same category of combo)
 * - Same type: compare by rank, then suit
 * - Cross-type (5-card combos only):
 *   - straightFlush beats everything
 *   - fourOfAKind beats straight and fullHouse
 *   - straight < fullHouse < fourOfAKind < straightFlush
 *
 * Returns true if play2 beats play1.
 */
export function beats(play1: Combo, play2: Combo): boolean {
  // Must match card count
  if (play1.cards.length !== play2.cards.length) return false;

  const power1 = COMBO_POWER[play1.type];
  const power2 = COMBO_POWER[play2.type];

  // Cross-type comparison for 5-card combos
  if (power2 > power1) return true;
  if (power2 < power1) return false;

  // Same power level: must be same type for non-bomb combos
  // For 5-card combos at power 0 (straight vs fullHouse), they cannot beat each other
  if (play1.type !== play2.type) return false;

  // Same type: compare rank then suit
  if (play2.rank > play1.rank) return true;
  if (play2.rank < play1.rank) return false;
  return play2.suit > play1.suit;
}
