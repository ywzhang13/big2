// 2026-10 第三批老闆規則：①開局補花就八仙／七搶一 ②有四喜時所有牌型都不加風牌台
// ③八仙過海／七搶一照一般胡牌連莊換莊、莊家台照「付款雙方有莊家才加」。
// 共同設定：底 100、每台 20、dealer=seat 0、doorSeat=0（seat0 東、1 南、2 西、3 北）、圈風東。
import {
  declareWin, calculateSettlement, drawTile, robFlower, checkDealFlowerWin, startNextGame,
} from "../lib/mahjong/gameLogic";
import type { MahjongGameState, Meld } from "../lib/mahjong/gameState";
import type { Tile, TileSuit } from "../lib/mahjong/tiles";

let nextId = 6000;
function t(key: string): Tile {
  return { id: nextId++, suit: key[0] as TileSuit, rank: parseInt(key.slice(1), 10), display: key };
}
const tiles = (keys: string) => keys.split(" ").filter(Boolean).map(t);
const FLOWERS7 = "f1 f2 f3 f4 f5 f6 f7";

function baseState(consecutive = 0): MahjongGameState {
  return {
    roomCode: "TEST", status: "playing",
    players: [0, 1, 2, 3].map((seat) => ({
      id: "p" + seat, name: "P" + seat, seat, hand: tiles("m1 m1 m3 m4 m6 m7 m8 m9 s1 s3 s5 s9 z1 z2 z3 z6"),
      revealed: [] as Meld[], flowers: [] as Tile[], discards: [t("m9")], isDealer: seat === 0,
    })),
    wall: tiles(Array(40).fill("m9").join(" ")),
    currentTurn: 1, lastDiscard: null, dealerSeat: 0, doorSeat: 0, prevalentWind: 1,
    turnCount: 8, hasDrawn: false, isFirstRound: false, isAfterKong: false,
    roomSettings: { totalRounds: 2, basePoints: 100, fanPoints: 20 },
    roundInfo: { currentRound: 1, currentGame: 1, dealerConsecutive: consecutive, initialDealerSeat: 0 },
    playerScores: [0, 0, 0, 0],
  } as MahjongGameState;
}
const fanStr = (st: MahjongGameState) =>
  (st.winners ?? []).map((w) => `seat${w.seat}:${w.score.fans.map((f) => f.name + f.value).join("+")}=${w.score.totalFan}`).join(" | ");
const results: string[] = [];
function eq(actual: unknown, expected: unknown, msg: string, detail = "") {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  results.push(`${ok ? "✅" : "❌"} ${msg}\n   預期=${JSON.stringify(expected)} 實際=${JSON.stringify(actual)}${detail ? "\n   " + detail : ""}`);
}
/** seat1（南）胡 seat3 打的 winKey */
function ronSeat1(hand: string, winKey: string) {
  const s = baseState();
  s.players[1].hand = tiles(hand);
  s.lastDiscard = { tile: t(winKey), from: 3 };
  return declareWin(s, 1, false);
}
/** seat 摸到第 8 張花（自己已有 7 張）→ 八仙過海 */
function baXian(seat: number, consecutive: number) {
  const s = baseState(consecutive);
  s.currentTurn = seat;
  s.players[seat].flowers = tiles(FLOWERS7);
  s.wall[0] = t("f8");
  return drawTile(s);
}

// ② 一般牌型的小四喜／大四喜也不加風牌台
{
  const r = ronSeat1("z1 z1 z1 z2 z2 z2 z3 z3 z3 m1 m2 m3 p4 p5 p6 z4", "z4");
  const w = r.winners![0].score;
  eq([w.fans.some((f) => f.name === "風牌"), w.totalFan], [false, 12],
    "②a 一般牌型小四喜（東南西刻＋北對）：門清1+獨聽1+小四喜8+三暗刻2=12，不加風牌（原本會多 東圈風1+南門風1）", fanStr(r));
}
{
  const r = ronSeat1("z1 z1 z1 z2 z2 z2 z3 z3 z3 z4 z4 z4 m1 m2 m3 m5", "m5");
  const w = r.winners![0].score;
  eq([w.fans.some((f) => f.name === "風牌"), w.totalFan], [false, 27],
    "②b 一般牌型大四喜：門清1+獨聽1+混一色4+大四喜16+四暗刻5=27，不加風牌", fanStr(r));
}

// ③ 八仙過海／七搶一的莊家台（PM 驗收例子）
{
  const n = baXian(1, 0);
  eq(calculateSettlement(n).deltas, [-280, 800, -260, -260], "③a 閒家 seat1 八仙、連莊 0：閒家各付 260，莊家付 100+(8+1)×20=280", fanStr(n));
}
{
  const n = baXian(0, 1);
  eq(calculateSettlement(n).deltas, [960, -320, -320, -320], "③b 莊家八仙、連莊 1：三家各付 100+(8+1+1+1)×20=320", fanStr(n));
}
{
  const s = baseState(0);
  s.players[0].flowers = tiles(FLOWERS7);
  s.wall[0] = t("f8");
  const robbed = robFlower(drawTile(s)); // seat1 摸到第 8 張，莊家 seat0 七搶一
  eq(calculateSettlement(robbed).deltas, [840, -280, -280, -280], "③c 莊家七搶一、連莊 0：三家各付 100+(8+1)×20=280（摸到花的人也付）", fanStr(robbed));
}
// ③ 連莊／換莊
{
  const n = baXian(1, 2);
  const next = startNextGame(n);
  eq([next.dealerSeat, next.roundInfo!.dealerConsecutive], [1, 0], "③d 閒家八仙胡：換莊給 seat1，連莊歸 0");
}
{
  const n = baXian(0, 1);
  const next = startNextGame(n);
  eq([next.dealerSeat, next.roundInfo!.dealerConsecutive], [0, 2], "③e 莊家八仙胡：連莊（1→2）");
}

// ① 開局補花完的判斷（dealTiles 最後會呼叫 checkDealFlowerWin）
{
  const s = baseState(0);
  s.currentTurn = 0; s.hasDrawn = true;
  s.players[2].flowers = tiles("f1 f2 f3 f4 f5 f6 f7 f8");
  const n = checkDealFlowerWin(s);
  eq([n.status, n.winners?.[0].seat, n.winners?.[0].score.fans[0].name, calculateSettlement(n).deltas],
    ["finished", 2, "八仙過海", [-280, -260, 800, -260]], "①a 開局 seat2 就有 8 張花：八仙過海立刻結束，莊家付 280", fanStr(n));
}
{
  const s = baseState(0);
  s.currentTurn = 0; s.hasDrawn = true;
  s.players[3].flowers = tiles(FLOWERS7);
  s.players[1].flowers = tiles("f8");
  const n = checkDealFlowerWin(s);
  eq([n.status, n.pendingFlowerRob?.robberSeat, n.pendingFlowerRob?.fromSeat, n.pendingFlowerRob?.tile.display, n.currentTurn],
    ["playing", 3, 1, "f8", 0], "①b 開局 seat3 有 7 張、seat1 有第 8 張：等 seat3 決定七搶一，輪到的還是莊家");
  const robbed = robFlower(n);
  eq([robbed.status, robbed.winners?.[0].seat, robbed.players[1].flowers.length, calculateSettlement(robbed).deltas],
    ["finished", 3, 0, [-280, -260, -260, 800]], "①c 開局七搶一搶了：seat3 胡，莊家付 280、閒家各付 260");
}
{
  const s = baseState(0);
  s.players[3].flowers = tiles("f1 f2 f3 f4 f5 f6");
  s.players[1].flowers = tiles("f7 f8");
  const n = checkDealFlowerWin(s);
  eq([n.status, n.pendingFlowerRob ?? null], ["playing", null], "①d 開局 6＋2 張：不觸發");
}

console.log(results.join("\n"));
if (results.some((r) => r.startsWith("❌"))) process.exit(1);
