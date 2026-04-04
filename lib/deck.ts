import { ALL_CARDS, Card } from "./constants";
import { compareCards } from "./card";

/**
 * Shuffle an array in place using the Fisher-Yates algorithm.
 * Returns the same array reference.
 */
export function shuffle<T>(array: T[]): T[] {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
}

/**
 * Deal a shuffled deck into 4 hands of 13 cards each, sorted by rank/suit.
 */
export function deal(): [Card[], Card[], Card[], Card[]] {
  const deck = shuffle([...ALL_CARDS]);

  const hands: [Card[], Card[], Card[], Card[]] = [
    deck.slice(0, 13),
    deck.slice(13, 26),
    deck.slice(26, 39),
    deck.slice(39, 52),
  ];

  for (const hand of hands) {
    hand.sort(compareCards);
  }

  return hands;
}
