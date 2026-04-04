// Card type is a string like "3C", "AS", "2H", "10D"
export type Card = string;

export const SUITS = ["C", "D", "H", "S"] as const;
export type Suit = (typeof SUITS)[number];

// Suit ranking: S > H > D > C
export const SUIT_VALUE: Record<string, number> = {
  C: 0,
  D: 1,
  H: 2,
  S: 3,
};

export const RANKS = [
  "3",
  "4",
  "5",
  "6",
  "7",
  "8",
  "9",
  "10",
  "J",
  "Q",
  "K",
  "A",
  "2",
] as const;
export type Rank = (typeof RANKS)[number];

// Card ranking: 2 > A > K > Q > J > 10 > 9 > 8 > 7 > 6 > 5 > 4 > 3
export const RANK_VALUE: Record<string, number> = {
  "3": 3,
  "4": 4,
  "5": 5,
  "6": 6,
  "7": 7,
  "8": 8,
  "9": 9,
  "10": 10,
  J: 11,
  Q: 12,
  K: 13,
  A: 14,
  "2": 15,
};

export const COMBO_TYPES = [
  "single",
  "pair",
  "straight",
  "fullHouse",
  "fourOfAKind",
  "straightFlush",
] as const;
export type ComboType = (typeof COMBO_TYPES)[number];

// Combo type power for cross-type comparison
// fourOfAKind beats non-bomb combos; straightFlush beats everything
export const COMBO_POWER: Record<ComboType, number> = {
  single: 0,
  pair: 0,
  straight: 0,
  fullHouse: 0,
  fourOfAKind: 1,
  straightFlush: 2,
};

// Generate all 52 cards
export const ALL_CARDS: Card[] = [];
for (const rank of RANKS) {
  for (const suit of SUITS) {
    ALL_CARDS.push(`${rank}${suit}`);
  }
}
