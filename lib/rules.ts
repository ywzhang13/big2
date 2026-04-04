import { Card } from "./constants";
import { Combo, detectCombo } from "./combo";
import { beats } from "./compare";

export interface PlayResult {
  valid: boolean;
  combo?: Combo;
  error?: string;
}

/**
 * Validate a play attempt.
 *
 * @param hand - The player's current hand
 * @param selectedCards - The cards the player wants to play
 * @param lastPlay - The last combo played (null if new round)
 * @param isFirstTurn - Whether this is the very first turn of the game
 * @param isNewRound - Whether this is a new round (all others passed)
 */
export function validatePlay(
  hand: Card[],
  selectedCards: Card[],
  lastPlay: Combo | null,
  isFirstTurn: boolean,
  isNewRound: boolean
): PlayResult {
  // Must select at least one card
  if (selectedCards.length === 0) {
    return { valid: false, error: "必須選擇至少一張牌" };
  }

  // All selected cards must be in the player's hand
  const handSet = new Set(hand);
  for (const card of selectedCards) {
    if (!handSet.has(card)) {
      return { valid: false, error: `手牌中沒有 ${card}` };
    }
  }

  // First turn must include 3 of clubs
  if (isFirstTurn && !selectedCards.includes("3C")) {
    return { valid: false, error: "第一手必須出梅花3" };
  }

  // Must be a valid combo
  const combo = detectCombo(selectedCards);
  if (!combo) {
    return { valid: false, error: "無效的牌型" };
  }

  // If new round, any valid combo is fine
  if (isNewRound || lastPlay === null) {
    return { valid: true, combo };
  }

  // Must match the card count of the last play
  if (selectedCards.length !== lastPlay.cards.length) {
    return {
      valid: false,
      error: `必須出 ${lastPlay.cards.length} 張牌`,
    };
  }

  // Must beat the last play
  if (!beats(lastPlay, combo)) {
    return { valid: false, error: "必須出比上家更大的牌" };
  }

  return { valid: true, combo };
}
