// Taiwan Mahjong winning hand detection
// Standard winning hand: 5 melds (sets) + 1 pair = 17 tiles when winning
// A meld is either: 刻子 (triple, 3 same) or 順子 (sequence, 3 consecutive in same suit)
// 字牌 cannot form 順子, only 刻子

import { Tile, tileKey, TileSuit } from "./tiles";

/** Convert a hand of tiles to a count map by key */
function toCountMap(tiles: Tile[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const t of tiles) {
    if (t.suit === "f") continue; // flowers don't count for winning hand
    const k = tileKey(t);
    map.set(k, (map.get(k) || 0) + 1);
  }
  return map;
}

/** Try to form N melds from the remaining tiles (recursive). */
function canFormMelds(counts: Map<string, number>, meldsNeeded: number): boolean {
  if (meldsNeeded === 0) {
    // all counts should be 0
    for (const v of counts.values()) if (v !== 0) return false;
    return true;
  }

  // Find the first non-zero key
  const keys = Array.from(counts.keys()).sort();
  let firstKey: string | null = null;
  for (const k of keys) {
    if ((counts.get(k) || 0) > 0) {
      firstKey = k;
      break;
    }
  }
  if (firstKey === null) return false;

  const suit = firstKey[0] as TileSuit;
  const rank = parseInt(firstKey.slice(1), 10);

  // Try 刻子 (triple)
  if ((counts.get(firstKey) || 0) >= 3) {
    counts.set(firstKey, (counts.get(firstKey) || 0) - 3);
    if (canFormMelds(counts, meldsNeeded - 1)) {
      counts.set(firstKey, (counts.get(firstKey) || 0) + 3);
      return true;
    }
    counts.set(firstKey, (counts.get(firstKey) || 0) + 3);
  }

  // Try 順子 (sequence) — only for m/p/s
  if (suit === "m" || suit === "p" || suit === "s") {
    if (rank <= 7) {
      const k1 = firstKey;
      const k2 = `${suit}${rank + 1}`;
      const k3 = `${suit}${rank + 2}`;
      if ((counts.get(k1) || 0) >= 1 && (counts.get(k2) || 0) >= 1 && (counts.get(k3) || 0) >= 1) {
        counts.set(k1, (counts.get(k1) || 0) - 1);
        counts.set(k2, (counts.get(k2) || 0) - 1);
        counts.set(k3, (counts.get(k3) || 0) - 1);
        if (canFormMelds(counts, meldsNeeded - 1)) {
          counts.set(k1, (counts.get(k1) || 0) + 1);
          counts.set(k2, (counts.get(k2) || 0) + 1);
          counts.set(k3, (counts.get(k3) || 0) + 1);
          return true;
        }
        counts.set(k1, (counts.get(k1) || 0) + 1);
        counts.set(k2, (counts.get(k2) || 0) + 1);
        counts.set(k3, (counts.get(k3) || 0) + 1);
      }
    }
  }

  return false;
}

/**
 * Check if a set of tiles forms a complete winning hand.
 * Standard Taiwan winning = 5 melds + 1 pair = 17 tiles (ignoring flowers and revealed melds).
 *
 * @param concealed tiles still in hand
 * @param revealedMelds count of already-revealed melds (碰/槓/吃)
 * @returns true if winning
 */
export function isWinningHand(concealed: Tile[], revealedMelds: number = 0): boolean {
  const meldsNeeded = 5 - revealedMelds;
  const expectedTiles = meldsNeeded * 3 + 2; // + pair

  const nonFlower = concealed.filter((t) => t.suit !== "f");
  if (nonFlower.length !== expectedTiles) return false;

  const counts = toCountMap(nonFlower);

  // Try each possible pair
  const keys = Array.from(counts.keys());
  for (const pairKey of keys) {
    if ((counts.get(pairKey) || 0) >= 2) {
      counts.set(pairKey, (counts.get(pairKey) || 0) - 2);
      if (canFormMelds(counts, meldsNeeded)) {
        counts.set(pairKey, (counts.get(pairKey) || 0) + 2);
        return true;
      }
      counts.set(pairKey, (counts.get(pairKey) || 0) + 2);
    }
  }

  return false;
}

/**
 * Find all tiles that would complete this hand (waiting tiles / 聽牌).
 * Returns list of tile keys that would win.
 */
export function findWaitingTiles(concealed: Tile[], revealedMelds: number = 0): string[] {
  const waiting: string[] = [];
  const allKeys: string[] = [];

  // Generate all possible tile keys
  for (const suit of ["m", "p", "s"] as const) {
    for (let r = 1; r <= 9; r++) allKeys.push(`${suit}${r}`);
  }
  for (let r = 1; r <= 7; r++) allKeys.push(`z${r}`);

  for (const key of allKeys) {
    // Create a fake tile to add to hand
    const suit = key[0] as TileSuit;
    const rank = parseInt(key.slice(1), 10);
    const testTile: Tile = { id: -1, suit, rank, display: "" };
    const testHand = [...concealed, testTile];
    if (isWinningHand(testHand, revealedMelds)) {
      waiting.push(key);
    }
  }

  return waiting;
}
