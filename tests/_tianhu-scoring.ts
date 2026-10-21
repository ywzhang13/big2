// 2026-10-21 老闆規則：天胡只和莊家台（含連莊、拉莊）、花台、風台一起算；門清、自摸、門清自摸（不求人）、獨聽等牌型台都不加。
//   T1 固定種子產生 2000 手各式胡牌：非天胡的每一手，台數和台名都和改前（fixtures 基準檔）完全一樣
//   T2 同一批裡的天胡：只剩 天胡／莊家／正花／春夏秋冬／梅蘭菊竹／八仙過海／風牌
//   T3 指定牌型：莊家起手自摸、帶正花和風刻 → 天胡 24＋莊家 1＋正花＋風牌，沒有門清自摸、獨聽
//   T4 真實結算流程（declareWin）：連 2 拉 2 照加；結算照自摸三家付；整場統計、斗內共用的自摸判斷照樣算自摸
// 重產基準檔（只能在改規則之前跑）：WRITE_GOLDEN=1 node --import ./tests/support/register.mjs tests/_tianhu-scoring.ts
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { calculateScore, type ScoringContext } from "../lib/mahjong/scoring";
import { calculateSettlement, declareWin, isSelfDrawWin, tallyHandStats } from "../lib/mahjong/gameLogic";
import type { MahjongGameState, Meld } from "../lib/mahjong/gameState";
import type { Tile, TileSuit } from "../lib/mahjong/tiles";

const results: string[] = [];
function eq(a: unknown, e: unknown, msg: string) {
  const ok = JSON.stringify(a) === JSON.stringify(e);
  results.push(`${ok ? "✅" : "❌"} ${msg}${ok ? "" : `\n   預期=${JSON.stringify(e)}\n   實際=${JSON.stringify(a)}`}`);
}
const GOLDEN = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "fixtures/scoring-golden-2026-10-21.json");
const TIANHU_OK = ["天胡", "莊家", "正花", "春夏秋冬", "梅蘭菊竹", "八仙過海", "風牌"];

let nextId = 9000;
const t = (key: string): Tile => ({ id: nextId++, suit: key[0] as TileSuit, rank: parseInt(key.slice(1), 10), display: key });
const tiles = (keys: string) => keys.split(" ").filter(Boolean).map(t);

// ---- T1／T2：固定種子的隨機胡牌 ----
function rng(seed: number) {
  return () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let x = Math.imul(seed ^ (seed >>> 15), 1 | seed); x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x; return ((x ^ (x >>> 14)) >>> 0) / 4294967296; };
}
const R = rng(20261021);
const pick = <T,>(a: T[]) => a[Math.floor(R() * a.length)];
const KINDS = [..."mps"].flatMap((s) => Array.from({ length: 9 }, (_, i) => s + (i + 1))).concat(Array.from({ length: 7 }, (_, i) => "z" + (i + 1)));
function makeCase(): ScoringContext {
  for (;;) {
    const used = new Map<string, number>();
    const take = (keys: string[]) => keys.forEach((k) => used.set(k, (used.get(k) ?? 0) + 1));
    const melds: { kind: "chi" | "pong" | "kong"; keys: string[] }[] = [];
    // 偏向字牌和刻子，讓風牌、三元、四喜、碰碰胡都有機會出現
    for (let i = 0; i < 5; i++) {
      const r = R();
      if (r < 0.45) { const s = pick([..."mps"]), n = 1 + Math.floor(R() * 7); melds.push({ kind: "chi", keys: [s + n, s + (n + 1), s + (n + 2)] }); }
      else { const k = R() < 0.4 ? "z" + (1 + Math.floor(R() * 7)) : pick(KINDS); melds.push({ kind: R() < 0.1 ? "kong" : "pong", keys: Array(R() < 0.1 ? 4 : 3).fill(k) }); }
    }
    melds.forEach((m) => { if (m.kind === "kong") m.keys = Array(4).fill(m.keys[0]); if (m.kind === "pong") m.keys = m.keys.slice(0, 3); take(m.keys); });
    const pair = pick(KINDS); take([pair, pair]);
    if ([...used.values()].some((c) => c > 4)) continue;
    const nRev = pick([0, 0, 0, 0, 1, 1, 2, 3, 5]);
    const revealed: Meld[] = [], concealed: Tile[] = [];
    melds.forEach((m, i) => {
      if (i < nRev || m.kind === "kong") revealed.push({ type: m.kind === "kong" ? (R() < 0.5 ? "concealed_kong" : "kong") : m.kind, tiles: tiles(m.keys.join(" ")) });
      else concealed.push(...tiles(m.keys.join(" ")));
    });
    concealed.push(...tiles(`${pair} ${pair}`));
    if (concealed.length === 0) continue;
    const flowers = Array.from({ length: 8 }, (_, i) => i + 1).filter(() => R() < 0.25).map((r) => t("f" + r));
    const isSelfDraw = R() < 0.5;
    const winTile = concealed[Math.floor(R() * concealed.length)];
    return {
      concealed, revealed, winTile, isSelfDraw, isDealer: R() < 0.4, seatWind: 1 + Math.floor(R() * 4), prevalentWind: 1 + Math.floor(R() * 4), flowers,
      isLastTile: R() < 0.1, isAfterKong: isSelfDraw && R() < 0.1, isRobbingKong: !isSelfDraw && R() < 0.05, isFirstDraw: R() < 0.3, isTing: R() < 0.1,
    };
  }
}
const cases = Array.from({ length: 2000 }, makeCase);
const fmt = (r: { fans: { name: string; value: number }[]; totalFan: number }) => `${r.totalFan}|${r.fans.map((f) => f.name + f.value).join(",")}`;
const out = cases.map((c) => fmt(calculateScore(c)));
const isTianhu = (c: ScoringContext) => c.isFirstDraw && c.isDealer;
if (process.env.WRITE_GOLDEN) {
  writeFileSync(GOLDEN, JSON.stringify(out, null, 0).replace(/","/g, '",\n"') + "\n");
  console.log(`基準檔已寫入 ${cases.length} 手`);
} else {
  const golden: string[] = JSON.parse(readFileSync(GOLDEN, "utf8"));
  const non = cases.map((c, i) => i).filter((i) => !isTianhu(cases[i]));
  const diff = non.filter((i) => out[i] !== golden[i]);
  const names = new Set(non.flatMap((i) => out[i].split("|")[1].split(",").map((f) => f.replace(/\d+$/, "")).filter(Boolean)));
  eq([golden.length, diff.length, diff.slice(0, 3).map((i) => [i, golden[i], out[i]])], [cases.length, 0, []],
    `T1 非天胡 ${non.length} 手（含地胡、地聽、門清自摸、獨聽、平胡、四喜、八仙等 ${names.size} 種台）：台數、台名和改前完全一樣`);
  const th = cases.map((c, i) => i).filter((i) => isTianhu(cases[i]));
  const badTh = th.filter((i) => !out[i].split("|")[1].split(",").every((f) => TIANHU_OK.includes(f.replace(/\d+$/, ""))) || !out[i].includes("天胡24"));
  const changed = th.filter((i) => out[i] !== golden[i]).length;
  eq([th.length > 100, badTh.map((i) => out[i]).slice(0, 3)], [true, []], `T2 天胡 ${th.length} 手（其中 ${changed} 手原本疊了其他台）：只剩天胡、莊家、花台、風台`);
}

// ---- T3：指定牌型 ----
// 莊家（東家、東風圈）起手 17 張自摸：東風刻、中刻、三副順子、眼 5p；花：春（正花）、夏
{
  const concealed = tiles("z1 z1 z1 z5 z5 z5 m1 m2 m3 m4 m5 m6 s7 s8 s9 p5 p5");
  const ctx: ScoringContext = { concealed, revealed: [], winTile: concealed[concealed.length - 1], isSelfDraw: true, isDealer: true, seatWind: 1, prevalentWind: 1,
    flowers: tiles("f1 f2"), isLastTile: false, isAfterKong: false, isRobbingKong: false, isFirstDraw: true, isTing: false };
  const r = calculateScore(ctx);
  eq([r.fans.map((f) => f.name + f.value), r.totalFan], [["天胡24", "莊家1", "風牌1", "風牌1", "正花1"], 28],
    "T3 天胡帶東風刻（門風＋圈風）和正花：天胡 24＋莊家 1＋風牌 2＋正花 1＝28；沒有門清自摸、獨聽、三元牌");
  const non = calculateScore({ ...ctx, isFirstDraw: false });
  eq(non.fans.some((f) => f.name === "門清自摸") && non.fans.some((f) => f.name === "三元牌"), true, "T3b 同一手不是天胡時：門清自摸、三元牌照算（只限制天胡）");
  // 大四喜也是天胡：四喜不算，四副風刻照門風、圈風算風牌
  const sixi = tiles("z1 z1 z1 z2 z2 z2 z3 z3 z3 z4 z4 z4 m1 m2 m3 p5 p5");
  const s4 = calculateScore({ ...ctx, concealed: sixi, winTile: sixi[16], flowers: [] });
  eq(s4.fans.map((f) => f.name + f.value), ["天胡24", "莊家1", "風牌1", "風牌1"], "T3c 天胡＋大四喜：不加大四喜，東風刻照算風牌 2");
}

// ---- T4：真實結算流程 ----
{
  const hand = tiles("z1 z1 z1 z5 z5 z5 m1 m2 m3 m4 m5 m6 s7 s8 s9 p5 p5");
  const s = {
    roomCode: "TEST", status: "playing",
    players: [0, 1, 2, 3].map((seat) => ({ id: "p" + seat, name: "P" + seat, seat, hand: seat === 0 ? hand : tiles("m9 m9 m9 m8 m8 m8 m7 m7 m7 s1 s1 s1 s2 s2 s2 s3"),
      revealed: [] as Meld[], flowers: seat === 0 ? tiles("f1") : [], discards: [] as Tile[], isDealer: seat === 0 })),
    wall: tiles(Array(60).fill("p9").join(" ")), currentTurn: 0, hasDrawn: true, drawnTileId: hand[16].id, lastDiscard: null, dealerSeat: 0, doorSeat: 0, prevalentWind: 1,
    isFirstRound: true, isAfterKong: false, roundInfo: { dealerConsecutive: 2 }, roomSettings: { basePoints: 100, fanPoints: 20, totalRounds: 1 },
  } as unknown as MahjongGameState;
  const r = declareWin(s, 0, true);
  const w = r.winners![0];
  eq([w.score.fans.map((f) => f.name + f.value), w.score.totalFan], [["天胡24", "莊家1", "風牌1", "風牌1", "正花1", "連22", "拉22"], 32],
    "T4 莊家連 2 拉 2 天胡：天胡、莊家、風牌、正花，再加連 2、拉 2＝32");
  const set = calculateSettlement(r);
  eq([set.reason, set.deltas], ["self_draw", [3 * (100 + 32 * 20), -(100 + 32 * 20), -(100 + 32 * 20), -(100 + 32 * 20)]],
    "T4c 結算照自摸算：三家各付 底 100＋32 台×20＝740（天胡沒有自摸台，也不會被當成放槍而沒人付）");
  tallyHandStats(r);
  eq([isSelfDrawWin(w), r.handStats!.selfDraws], [true, [1, 0, 0, 0]], "T4b 整場統計、斗內共用的自摸判斷：天胡照樣算莊家自摸一次（自摸台拿掉不影響）");
}

console.log(results.join("\n"));
if (results.some((r) => r.startsWith("❌"))) process.exit(1);
