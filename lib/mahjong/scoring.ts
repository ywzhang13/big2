// Taiwan 16-tile Mahjong scoring (台數計算)

import { Tile, tileKey, TileSuit, isFlower, isDragon, isWind } from "./tiles";
import { Meld, ScoreResult } from "./gameState";
import { isWinningHand, findWaitingTiles } from "./winCheck";

export interface ScoringContext {
  concealed: Tile[]; // 暗牌 (including winTile if self-draw)
  revealed: Meld[]; // 明牌（吃碰槓）
  winTile: Tile; // 胡的那張牌
  isSelfDraw: boolean; // 自摸
  isDealer: boolean; // 莊家
  seatWind: number; // 自風 (1-4: 東南西北)
  prevalentWind: number; // 場風
  flowers: Tile[]; // 花牌
  isLastTile: boolean; // 海底撈月
  isAfterKong: boolean; // 槓上開花
  isRobbingKong: boolean; // 搶槓
  isFirstDraw: boolean; // 天/地胡
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

interface ParsedHand {
  pair: string; // tileKey of the pair
  melds: ParsedMeld[];
}

interface ParsedMeld {
  type: "chi" | "pong" | "kong" | "concealed_kong";
  tileKeys: string[]; // sorted tile keys in the meld
  isConcealed: boolean;
}

/** Count map from tile key to count */
function toCountMap(tiles: Tile[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const t of tiles) {
    if (t.suit === "f") continue;
    const k = tileKey(t);
    m.set(k, (m.get(k) || 0) + 1);
  }
  return m;
}

/**
 * Enumerate all possible meld decompositions of the concealed hand.
 * Returns array of ParsedHand (pair + melds from concealed tiles).
 */
function decomposeHand(concealed: Tile[], revealed: Meld[]): ParsedHand[] {
  const nonFlower = concealed.filter((t) => t.suit !== "f");
  const counts = toCountMap(nonFlower);
  const revealedMelds: ParsedMeld[] = revealed.map((m) => ({
    type: m.type,
    tileKeys: m.tiles.map(tileKey).sort(),
    isConcealed: m.type === "concealed_kong",
  }));

  const meldsNeeded = 5 - revealed.length;
  const results: ParsedHand[] = [];

  const keys = Array.from(counts.keys()).sort();

  // Try each possible pair
  for (const pairKey of keys) {
    if ((counts.get(pairKey) || 0) < 2) continue;
    counts.set(pairKey, counts.get(pairKey)! - 2);

    const concealedMelds: ParsedMeld[] = [];
    findMelds(counts, meldsNeeded, concealedMelds, results, pairKey, revealedMelds);

    counts.set(pairKey, counts.get(pairKey)! + 2);
  }

  return results;
}

function findMelds(
  counts: Map<string, number>,
  needed: number,
  current: ParsedMeld[],
  results: ParsedHand[],
  pairKey: string,
  revealedMelds: ParsedMeld[]
): void {
  if (needed === 0) {
    // Check all counts are 0
    let allZero = true;
    for (const v of counts.values()) {
      if (v !== 0) { allZero = false; break; }
    }
    if (allZero) {
      results.push({
        pair: pairKey,
        melds: [...current, ...revealedMelds],
      });
    }
    return;
  }

  // Find first non-zero key
  const keys = Array.from(counts.keys()).sort();
  let firstKey: string | null = null;
  for (const k of keys) {
    if ((counts.get(k) || 0) > 0) { firstKey = k; break; }
  }
  if (!firstKey) return;

  const suit = firstKey[0] as TileSuit;
  const rank = parseInt(firstKey.slice(1), 10);

  // Try triple (刻子)
  if ((counts.get(firstKey) || 0) >= 3) {
    counts.set(firstKey, counts.get(firstKey)! - 3);
    current.push({
      type: "pong",
      tileKeys: [firstKey, firstKey, firstKey],
      isConcealed: true,
    });
    findMelds(counts, needed - 1, current, results, pairKey, revealedMelds);
    current.pop();
    counts.set(firstKey, counts.get(firstKey)! + 3);
  }

  // Try sequence (順子) — only m/p/s
  if (suit === "m" || suit === "p" || suit === "s") {
    if (rank <= 7) {
      const k1 = firstKey;
      const k2 = `${suit}${rank + 1}`;
      const k3 = `${suit}${rank + 2}`;
      if (
        (counts.get(k1) || 0) >= 1 &&
        (counts.get(k2) || 0) >= 1 &&
        (counts.get(k3) || 0) >= 1
      ) {
        counts.set(k1, counts.get(k1)! - 1);
        counts.set(k2, counts.get(k2)! - 1);
        counts.set(k3, counts.get(k3)! - 1);
        current.push({
          type: "chi",
          tileKeys: [k1, k2, k3],
          isConcealed: true,
        });
        findMelds(counts, needed - 1, current, results, pairKey, revealedMelds);
        current.pop();
        counts.set(k1, counts.get(k1)! + 1);
        counts.set(k2, counts.get(k2)! + 1);
        counts.set(k3, counts.get(k3)! + 1);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Scoring functions
// ---------------------------------------------------------------------------

function isPong(m: ParsedMeld): boolean {
  return m.type === "pong" || m.type === "kong" || m.type === "concealed_kong";
}

function isChi(m: ParsedMeld): boolean {
  return m.type === "chi";
}

function meldSuit(m: ParsedMeld): string {
  return m.tileKeys[0][0];
}

function meldRank(m: ParsedMeld): number {
  return parseInt(m.tileKeys[0].slice(1), 10);
}

function isKong(m: ParsedMeld): boolean {
  return m.type === "kong" || m.type === "concealed_kong";
}

/**
 * Calculate score for a specific hand decomposition.
 */
function scoreDecomposition(
  hand: ParsedHand,
  ctx: ScoringContext
): ScoreResult {
  const fans: { name: string; value: number }[] = [];
  const isConcealed = ctx.revealed.length === 0; // 門清: no revealed melds

  // --- 天胡 / 地胡 ---
  if (ctx.isFirstDraw) {
    if (ctx.isDealer) {
      fans.push({ name: "天胡", value: 24 });
    } else {
      fans.push({ name: "地胡", value: 16 });
    }
  }

  // --- 莊家 ---
  if (ctx.isDealer) {
    fans.push({ name: "莊家", value: 1 });
  }

  // --- 門清自摸 / 門清 / 自摸 ---
  if (isConcealed && ctx.isSelfDraw) {
    fans.push({ name: "門清自摸", value: 3 });
  } else {
    if (isConcealed) {
      fans.push({ name: "門清", value: 1 });
    }
    if (ctx.isSelfDraw) {
      fans.push({ name: "自摸", value: 1 });
    }
  }

  // --- 獨聽 (single wait) ---
  // Build the hand without the winTile and check how many tiles it waits on
  const handWithoutWin = ctx.concealed.filter((t) => t.id !== ctx.winTile.id);
  // If not self-draw, winTile may not be in concealed — build test hand
  let testHand: Tile[];
  if (ctx.isSelfDraw) {
    testHand = handWithoutWin;
  } else {
    testHand = [...ctx.concealed]; // concealed does NOT include winTile for ron
  }
  const waits = findWaitingTiles(testHand, ctx.revealed.length);
  if (waits.length === 1) {
    fans.push({ name: "獨聽", value: 1 });
  }

  // --- Analyze melds ---
  const allMelds = hand.melds;
  const pongMelds = allMelds.filter(isPong);
  const chiMelds = allMelds.filter(isChi);
  // 暗刻 only counts triplets that are truly concealed:
  //   - Must come from concealed hand (isConcealed=true)
  //   - If winning by ron (not self-draw), the triplet containing the
  //     winning tile does NOT count (that tile was taken from a discard)
  const winTileKey = tileKey(ctx.winTile);
  const concealedPongs = pongMelds.filter((m) => {
    if (!m.isConcealed) return false;
    if (!ctx.isSelfDraw && m.tileKeys[0] === winTileKey) return false;
    return true;
  });

  // --- 中洞 / 邊張 ---
  // 中洞  — winTile is the MIDDLE rank of a concealed chi meld (e.g. 3-5 win 4)
  // 邊張 — winTile completes 1-2-3 as rank 3 (held 1-2) or 7-8-9 as rank 7
  //        (held 8-9). Only these two edge shapes qualify.
  const winRankNum = ctx.winTile.rank;
  for (const m of allMelds) {
    if (!isChi(m) || !m.isConcealed) continue;
    if (!m.tileKeys.includes(winTileKey)) continue;
    const ranks = m.tileKeys
      .map((k) => parseInt(k.slice(1), 10))
      .sort((a, b) => a - b);
    if (winRankNum === ranks[1]) {
      fans.push({ name: "中洞", value: 1 });
      break;
    }
    if (
      (ranks[0] === 1 && ranks[2] === 3 && winRankNum === 3) ||
      (ranks[0] === 7 && ranks[2] === 9 && winRankNum === 7)
    ) {
      fans.push({ name: "邊張", value: 1 });
      break;
    }
  }

  // --- 平胡: all chi + pair, no 字牌 ---
  const allTileKeys = [
    ...allMelds.flatMap((m) => m.tileKeys),
    hand.pair,
    hand.pair,
  ];
  const hasHonor = allTileKeys.some((k) => k[0] === "z");

  if (chiMelds.length === 5 && pongMelds.length === 0 && !hasHonor) {
    fans.push({ name: "平胡", value: 2 });
  }

  // --- 碰碰胡: all pong/kong, no chi ---
  if (pongMelds.length === 5 && chiMelds.length === 0) {
    fans.push({ name: "碰碰胡", value: 4 });
  }

  // --- Suits analysis ---
  const suitSet = new Set<string>();
  for (const k of allTileKeys) {
    suitSet.add(k[0]);
  }

  const numericSuits = new Set<string>();
  let hasZ = false;
  for (const s of suitSet) {
    if (s === "z") hasZ = true;
    else numericSuits.add(s);
  }

  // 清一色: one numeric suit, no honors
  if (numericSuits.size === 1 && !hasZ) {
    fans.push({ name: "清一色", value: 8 });
  }
  // 混一色: one numeric suit + honors
  else if (numericSuits.size === 1 && hasZ) {
    fans.push({ name: "混一色", value: 4 });
  }

  // --- 三元牌 & 大三元 & 小三元 ---
  const dragonKeys = ["z5", "z6", "z7"]; // 中發白
  let dragonPongCount = 0;
  let dragonPairCount = 0;

  for (const dk of dragonKeys) {
    if (pongMelds.some((m) => m.tileKeys[0] === dk)) {
      dragonPongCount++;
      fans.push({ name: "三元牌", value: 1 });
    }
  }
  if (dragonKeys.includes(hand.pair)) {
    dragonPairCount++;
  }

  if (dragonPongCount === 3) {
    fans.push({ name: "大三元", value: 8 });
  } else if (dragonPongCount === 2 && dragonPairCount === 1) {
    fans.push({ name: "小三元", value: 4 });
  }

  // --- 風牌 (seat wind / prevalent wind pong) ---
  const windKeys = ["z1", "z2", "z3", "z4"]; // 東南西北
  let windPongCount = 0;
  let windPairCount = 0;

  for (const wk of windKeys) {
    if (pongMelds.some((m) => m.tileKeys[0] === wk)) {
      windPongCount++;
      const windRank = parseInt(wk[1], 10);
      if (windRank === ctx.seatWind) {
        fans.push({ name: "風牌", value: 1 });
      }
      if (windRank === ctx.prevalentWind && windRank !== ctx.seatWind) {
        // Prevalent wind that is also seat wind already counted above;
        // but if prevalent != seat, count separately
        fans.push({ name: "風牌", value: 1 });
      }
      // If seat wind === prevalent wind, some rulesets give 2. We give 1 for seat + 1 for prevalent.
      if (windRank === ctx.prevalentWind && windRank === ctx.seatWind) {
        // Already added 1 for seat wind above; add 1 more for prevalent
        fans.push({ name: "風牌", value: 1 });
      }
    }
  }
  for (const wk of windKeys) {
    if (hand.pair === wk) windPairCount++;
  }

  // 大四喜: all 4 winds are pong/kong
  if (windPongCount === 4) {
    fans.push({ name: "大四喜", value: 16 });
  }
  // 小四喜: 3 wind pongs + 1 wind pair
  else if (windPongCount === 3 && windPairCount === 1) {
    fans.push({ name: "小四喜", value: 8 });
  }

  // --- 暗刻 ---
  const concealedPongCount = concealedPongs.length;
  if (concealedPongCount === 3) {
    fans.push({ name: "三暗刻", value: 2 });
  } else if (concealedPongCount === 4) {
    fans.push({ name: "四暗刻", value: 5 });
  } else if (concealedPongCount >= 5) {
    fans.push({ name: "五暗刻", value: 8 });
  }

  // --- 正花 ---
  // Each seat has a matching flower based on seatWind (relative to door/opener):
  //   seatWind=1 (東/門) → flower number 1 (春 Flower1, 梅 Flower5)
  //   seatWind=2 (南)   → flower number 2 (夏 Flower2, 蘭 Flower6)
  //   seatWind=3 (西)   → flower number 3 (秋 Flower3, 竹 Flower7)
  //   seatWind=4 (北)   → flower number 4 (冬 Flower4, 菊 Flower8)
  // Only matching flowers count — 1 台 each. Duplicates allowed.
  const matchingFlowers = ctx.flowers.filter(
    (f) => ((f.rank - 1) % 4) + 1 === ctx.seatWind
  ).length;
  if (matchingFlowers > 0) {
    fans.push({ name: "正花", value: matchingFlowers });
  }

  // 春夏秋冬 (flower ranks 1-4)
  const flowerRanks = new Set(ctx.flowers.map((f) => f.rank));
  const hasSpring = [1, 2, 3, 4].every((r) => flowerRanks.has(r));
  const hasPlum = [5, 6, 7, 8].every((r) => flowerRanks.has(r));

  if (hasSpring) {
    fans.push({ name: "春夏秋冬", value: 2 });
  }
  if (hasPlum) {
    fans.push({ name: "梅蘭竹菊", value: 2 });
  }
  // 八仙過海
  if (ctx.flowers.length === 8) {
    fans.push({ name: "八仙過海", value: 8 });
  }

  // --- 海底撈月 ---
  if (ctx.isLastTile && ctx.isSelfDraw) {
    fans.push({ name: "海底撈月", value: 1 });
  }

  // --- 槓上開花 ---
  if (ctx.isAfterKong && ctx.isSelfDraw) {
    fans.push({ name: "槓上開花", value: 1 });
  }

  // --- 搶槓胡 ---
  if (ctx.isRobbingKong) {
    fans.push({ name: "搶槓胡", value: 1 });
  }

  const totalFan = fans.reduce((sum, f) => sum + f.value, 0);
  return { fans, totalFan };
}

/**
 * Calculate the best score for a winning hand.
 * Tries all possible decompositions and returns the one with the highest fan count.
 */
export function calculateScore(ctx: ScoringContext): ScoreResult {
  const decompositions = decomposeHand(ctx.concealed, ctx.revealed);

  if (decompositions.length === 0) {
    // No valid decomposition — should not happen if hand is verified winning
    return { fans: [], totalFan: 0 };
  }

  let best: ScoreResult = { fans: [], totalFan: 0 };

  for (const hand of decompositions) {
    const result = scoreDecomposition(hand, ctx);
    if (result.totalFan > best.totalFan) {
      best = result;
    }
  }

  // Ensure minimum 1 台 (if no fans at all, Taiwan mahjong typically requires at least some台)
  return best;
}
