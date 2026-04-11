// Taiwan Mahjong tile system
// 144 tiles total: 萬筒條 (3×9×4=108) + 風牌 (4×4=16) + 箭牌 (3×4=12) + 花牌 (8)

export type TileSuit =
  | "m"   // 萬 (1-9, 4 each = 36)
  | "p"   // 筒 (1-9, 4 each = 36)
  | "s"   // 條 (1-9, 4 each = 36)
  | "z"   // 字牌 (1-7)
            // 1-4: 東南西北 (4 each = 16)
            // 5-7: 中發白 (4 each = 12)
  | "f";  // 花牌 (1-8): 春夏秋冬 + 梅蘭竹菊 (1 each = 8)

export interface Tile {
  id: number;      // unique id (0-143)
  suit: TileSuit;
  rank: number;    // for m/p/s: 1-9; for z: 1-7; for f: 1-8
  display: string; // short name like "1m", "5p", "東", "中", "春"
}

export const WIND_NAMES = ["東", "南", "西", "北"] as const;
export const DRAGON_NAMES = ["中", "發", "白"] as const;
export const FLOWER_NAMES = ["春", "夏", "秋", "冬", "梅", "蘭", "竹", "菊"] as const;

const SUIT_SYMBOLS: Record<TileSuit, string> = {
  m: "萬",
  p: "筒",
  s: "條",
  z: "",
  f: "",
};

export function tileDisplay(tile: Tile): string {
  if (tile.suit === "z") {
    if (tile.rank <= 4) return WIND_NAMES[tile.rank - 1];
    return DRAGON_NAMES[tile.rank - 5];
  }
  if (tile.suit === "f") {
    return FLOWER_NAMES[tile.rank - 1];
  }
  // m/p/s
  return `${tile.rank}${SUIT_SYMBOLS[tile.suit]}`;
}

/** Convert tile to short string key used for equality (ignores id) */
export function tileKey(tile: Tile): string {
  return `${tile.suit}${tile.rank}`;
}

export function parseKey(key: string): { suit: TileSuit; rank: number } {
  const suit = key[0] as TileSuit;
  const rank = parseInt(key.slice(1), 10);
  return { suit, rank };
}

/** Build the full 144-tile set */
export function buildTiles(): Tile[] {
  const tiles: Tile[] = [];
  let id = 0;

  // 萬筒條: 3 suits × 9 ranks × 4 copies = 108
  for (const suit of ["m", "p", "s"] as TileSuit[]) {
    for (let rank = 1; rank <= 9; rank++) {
      for (let copy = 0; copy < 4; copy++) {
        const tile: Tile = { id: id++, suit, rank, display: "" };
        tile.display = tileDisplay(tile);
        tiles.push(tile);
      }
    }
  }

  // 字牌: 7 types × 4 copies = 28 (4 winds + 3 dragons)
  for (let rank = 1; rank <= 7; rank++) {
    for (let copy = 0; copy < 4; copy++) {
      const tile: Tile = { id: id++, suit: "z", rank, display: "" };
      tile.display = tileDisplay(tile);
      tiles.push(tile);
    }
  }

  // 花牌: 8 types × 1 = 8
  for (let rank = 1; rank <= 8; rank++) {
    const tile: Tile = { id: id++, suit: "f", rank, display: "" };
    tile.display = tileDisplay(tile);
    tiles.push(tile);
  }

  return tiles;
}

/** Fisher-Yates shuffle */
export function shuffle<T>(arr: T[]): T[] {
  const result = [...arr];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

/** Sort tiles in display order: m < p < s < z (wind order) < f */
export function sortTiles(tiles: Tile[]): Tile[] {
  const suitOrder: Record<TileSuit, number> = { m: 0, p: 1, s: 2, z: 3, f: 4 };
  return [...tiles].sort((a, b) => {
    if (a.suit !== b.suit) return suitOrder[a.suit] - suitOrder[b.suit];
    return a.rank - b.rank;
  });
}

/** Check if a tile is a flower */
export function isFlower(tile: Tile): boolean {
  return tile.suit === "f";
}

/** Check if a tile is a dragon (中發白) */
export function isDragon(tile: Tile): boolean {
  return tile.suit === "z" && tile.rank >= 5;
}

/** Check if a tile is a wind (東南西北) */
export function isWind(tile: Tile): boolean {
  return tile.suit === "z" && tile.rank <= 4;
}
