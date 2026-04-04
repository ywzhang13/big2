import { Card, RANK_VALUE, SUIT_VALUE } from "./constants";

export interface ParsedCard {
  rank: number;
  suit: number;
  name: string;
}

/**
 * Parse a card string like "3C", "AS", "10H" into rank/suit values.
 */
export function parseCard(card: Card): ParsedCard {
  let rank: string;
  let suit: string;

  if (card.length === 3) {
    // "10X"
    rank = card.slice(0, 2);
    suit = card[2];
  } else {
    // "3C", "AS", etc.
    rank = card[0];
    suit = card[1];
  }

  return {
    rank: RANK_VALUE[rank],
    suit: SUIT_VALUE[suit],
    name: card,
  };
}

/**
 * Compare two cards by game rank (3 < 4 < ... < K < A < 2), then suit.
 */
export function compareCards(a: Card, b: Card): number {
  const pa = parseCard(a);
  const pb = parseCard(b);
  if (pa.rank !== pb.rank) return pa.rank - pb.rank;
  return pa.suit - pb.suit;
}

/**
 * Display sort order for hand: A, 2, 3, 4, 5, 6, 7, 8, 9, 10, J, Q, K
 * Then by suit: ♣ < ♦ < ♥ < ♠
 */
const DISPLAY_ORDER: Record<string, number> = {
  A: 1, "2": 2, "3": 3, "4": 4, "5": 5, "6": 6, "7": 7,
  "8": 8, "9": 9, "10": 10, J: 11, Q: 12, K: 13,
};

export function compareCardsDisplay(a: Card, b: Card): number {
  const pa = parseCard(a);
  const pb = parseCard(b);
  const ra = DISPLAY_ORDER[getCardRank(a)] || 0;
  const rb = DISPLAY_ORDER[getCardRank(b)] || 0;
  if (ra !== rb) return ra - rb;
  return pa.suit - pb.suit;
}

const SUIT_EMOJI: Record<string, string> = {
  S: "♠",
  H: "♥",
  D: "♦",
  C: "♣",
};

const SUIT_NAME: Record<string, string> = {
  S: "spades",
  H: "hearts",
  D: "diamonds",
  C: "clubs",
};

/**
 * Get the emoji for a suit character.
 */
export function getSuitEmoji(suit: string): string {
  return SUIT_EMOJI[suit] ?? suit;
}

/**
 * Get the full suit name.
 */
export function getSuitName(suit: string): string {
  return SUIT_NAME[suit] ?? suit;
}

/**
 * Extract the suit character from a card string.
 */
export function getCardSuit(card: Card): string {
  return card.length === 3 ? card[2] : card[1];
}

/**
 * Extract the rank label from a card string.
 */
export function getCardRank(card: Card): string {
  return card.length === 3 ? card.slice(0, 2) : card[0];
}

/**
 * Get a display string for a card, e.g. "♠A" or "♣3".
 */
export function cardDisplay(card: Card): string {
  const suit = getCardSuit(card);
  const rank = getCardRank(card);
  return `${getSuitEmoji(suit)}${rank}`;
}

/**
 * Get the color for a suit: red for hearts/diamonds, black for spades/clubs.
 */
export function getSuitColor(suit: string): "red" | "black" {
  return suit === "H" || suit === "D" ? "red" : "black";
}

/**
 * Get the color for a card.
 */
export function getCardColor(card: Card): "red" | "black" {
  return getSuitColor(getCardSuit(card));
}
