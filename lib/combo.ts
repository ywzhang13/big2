import { Card, ComboType } from "./constants";
import { parseCard, compareCards, ParsedCard } from "./card";

export interface Combo {
  type: ComboType;
  /** Primary rank used for comparison */
  rank: number;
  /** Suit used for tiebreaking */
  suit: number;
  /** The cards in this combo, sorted */
  cards: Card[];
}

/**
 * Detect the combo type from selected cards.
 * Returns a Combo object or null if the cards don't form a valid combo.
 *
 * Taiwan rules: only single, pair, straight(5), fullHouse, fourOfAKind, straightFlush.
 * NO triple, NO flush.
 */
export function detectCombo(cards: Card[]): Combo | null {
  const count = cards.length;

  if (count === 0) return null;

  const sorted = [...cards].sort(compareCards);
  const parsed = sorted.map(parseCard);

  if (count === 1) {
    return detectSingle(sorted, parsed);
  }

  if (count === 2) {
    return detectPair(sorted, parsed);
  }

  if (count === 5) {
    // Check from strongest to weakest
    return (
      detectStraightFlush(sorted, parsed) ??
      detectFourOfAKind(sorted, parsed) ??
      detectFullHouse(sorted, parsed) ??
      detectStraight(sorted, parsed)
    );
  }

  return null;
}

function detectSingle(sorted: Card[], parsed: ParsedCard[]): Combo {
  return {
    type: "single",
    rank: parsed[0].rank,
    suit: parsed[0].suit,
    cards: sorted,
  };
}

function detectPair(sorted: Card[], parsed: ParsedCard[]): Combo | null {
  if (parsed[0].rank !== parsed[1].rank) return null;
  // Pair rank is the shared rank; suit is the higher card's suit
  return {
    type: "pair",
    rank: parsed[0].rank,
    suit: Math.max(parsed[0].suit, parsed[1].suit),
    cards: sorted,
  };
}

/**
 * Check if 5 cards form a straight.
 *
 * Special cases:
 * - A2345 is the smallest straight (rank 5, uses the 5's properties for comparison)
 * - 23456 is the biggest straight (rank 15, compare by 2's suit since 2 is highest card)
 * - 10JQKA is a normal straight (rank 14)
 * - JQKA2 is NOT a valid straight
 */
function detectStraight(sorted: Card[], parsed: ParsedCard[]): Combo | null {
  const ranks = parsed.map((p) => p.rank);

  // Check for A2345 special case: ranks would be [3,4,5,14,15] after sort
  if (
    ranks[0] === 3 &&
    ranks[1] === 4 &&
    ranks[2] === 5 &&
    ranks[3] === 14 &&
    ranks[4] === 15
  ) {
    // A2345 is the smallest straight, rank = 5 (the highest of 3,4,5)
    // The determining card for suit comparison is the 5 (index 2)
    return {
      type: "straight",
      rank: 5,
      suit: parsed[2].suit,
      cards: sorted,
    };
  }

  // Normal consecutive check
  for (let i = 1; i < 5; i++) {
    if (ranks[i] !== ranks[0] + i) return null;
  }

  // The rank/suit of the straight is determined by the highest card
  const highest = parsed[4];

  // 23456 special: rank is 15 (the 2), compare by the 2's suit
  // For other straights, compare by the highest card
  return {
    type: "straight",
    rank: highest.rank,
    suit: highest.suit,
    cards: sorted,
  };
}

function detectFullHouse(sorted: Card[], parsed: ParsedCard[]): Combo | null {
  const ranks = parsed.map((p) => p.rank);

  // Pattern 1: AAABB (triple first, pair second)
  if (ranks[0] === ranks[1] && ranks[1] === ranks[2] && ranks[3] === ranks[4]) {
    return {
      type: "fullHouse",
      rank: ranks[0], // triple's rank
      suit: Math.max(parsed[0].suit, parsed[1].suit, parsed[2].suit),
      cards: sorted,
    };
  }

  // Pattern 2: AABBB (pair first, triple second)
  if (ranks[0] === ranks[1] && ranks[2] === ranks[3] && ranks[3] === ranks[4]) {
    return {
      type: "fullHouse",
      rank: ranks[2], // triple's rank
      suit: Math.max(parsed[2].suit, parsed[3].suit, parsed[4].suit),
      cards: sorted,
    };
  }

  return null;
}

function detectFourOfAKind(sorted: Card[], parsed: ParsedCard[]): Combo | null {
  const ranks = parsed.map((p) => p.rank);

  // Pattern 1: AAAAB
  if (
    ranks[0] === ranks[1] &&
    ranks[1] === ranks[2] &&
    ranks[2] === ranks[3]
  ) {
    return {
      type: "fourOfAKind",
      rank: ranks[0],
      suit: Math.max(parsed[0].suit, parsed[1].suit, parsed[2].suit, parsed[3].suit),
      cards: sorted,
    };
  }

  // Pattern 2: ABBBB
  if (
    ranks[1] === ranks[2] &&
    ranks[2] === ranks[3] &&
    ranks[3] === ranks[4]
  ) {
    return {
      type: "fourOfAKind",
      rank: ranks[1],
      suit: Math.max(parsed[1].suit, parsed[2].suit, parsed[3].suit, parsed[4].suit),
      cards: sorted,
    };
  }

  return null;
}

function detectStraightFlush(
  sorted: Card[],
  parsed: ParsedCard[]
): Combo | null {
  // All same suit?
  const suit = parsed[0].suit;
  if (!parsed.every((p) => p.suit === suit)) return null;

  // Must also be a straight
  const straight = detectStraight(sorted, parsed);
  if (!straight) return null;

  return {
    type: "straightFlush",
    rank: straight.rank,
    suit: straight.suit,
    cards: sorted,
  };
}
