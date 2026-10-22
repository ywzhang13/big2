// 2026-10 第二批老闆規則：字一色風牌、花槓 1 台、八仙過海／七搶一、剩 16 張不能槓、
// 摸牌後可做的動作（重新整理恢復按鈕用）。
// 共同設定：底 100、每台 20、dealer=seat 0、doorSeat=0（seat0 東、1 南、2 西、3 北）、圈風東。
import {
  declareWin, calculateSettlement, drawTile, executeConcealedKong, executeAction,
  getAvailableActions, startAddKong, ownTurnActions, canKongNow,
} from "../lib/mahjong/gameLogic";
import { calculateScore } from "../lib/mahjong/scoring";
import type { MahjongGameState, Meld } from "../lib/mahjong/gameState";
import type { Tile, TileSuit } from "../lib/mahjong/tiles";

let nextId = 3000;
function t(key: string): Tile {
  return { id: nextId++, suit: key[0] as TileSuit, rank: parseInt(key.slice(1), 10), display: key };
}
const tiles = (keys: string) => keys.split(" ").filter(Boolean).map(t);
const meld = (type: Meld["type"], keys: string): Meld => ({ type, tiles: tiles(keys) });
const FLOWERS7 = "f1 f2 f3 f4 f5 f6 f7";
const H_TWO_SIDED = "m1 m2 m3 m4 m5 m6 p7 p8 p9 s2 s3 s4 z4 z4 s5 s6"; // 聽 1s/4s/7s

function baseState(wallSize = 40): MahjongGameState {
  return {
    roomCode: "TEST", status: "playing",
    players: [0, 1, 2, 3].map((seat) => ({
      id: "p" + seat, name: "P" + seat, seat, hand: tiles(H_TWO_SIDED), revealed: [] as Meld[],
      flowers: [], discards: [t("m9")], isDealer: seat === 0,
    })),
    wall: tiles(Array(wallSize).fill("m9").join(" ")),
    currentTurn: 1, lastDiscard: null, dealerSeat: 0, doorSeat: 0, prevalentWind: 1,
    turnCount: 8, hasDrawn: false, isFirstRound: false, isAfterKong: false,
    roomSettings: { totalRounds: 1, basePoints: 100, fanPoints: 20 },
    roundInfo: { currentRound: 1, currentGame: 1, dealerConsecutive: 2, initialDealerSeat: 0 },
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
function throws(fn: () => unknown, msg: string) {
  try { fn(); results.push(`❌ ${msg}（沒有擋下）`); } catch (e) { results.push(`✅ ${msg}（${(e as Error).message}）`); }
}
/** seat1（南）胡 seat3 打的 winKey */
function ronSeat1(hand: string, winKey: string) {
  const s = baseState(); s.roundInfo!.dealerConsecutive = 0;
  s.players[1].hand = tiles(hand);
  s.lastDiscard = { tile: t(winKey), from: 3 };
  return declareWin(s, 1, false);
}

// ② 字一色 + 小四喜：不加風牌台
{
  const r = ronSeat1("z1 z1 z1 z2 z2 z2 z3 z3 z3 z5 z5 z5 z6 z6 z6 z4", "z4");
  const w = r.winners![0].score;
  eq([w.fans.some((f) => f.name === "風牌"), w.totalFan], [false, 40],
    "②a 字一色＋小四喜：門清1+獨聽1+碰碰胡4+字一色16+三元牌1×2+小四喜8+五暗刻8=40，不加風牌", fanStr(r));
}
// ② 字一色 + 大四喜：不加風牌台
{
  const r = ronSeat1("z1 z1 z1 z2 z2 z2 z3 z3 z3 z4 z4 z4 z6 z6 z6 z5", "z5");
  const w = r.winners![0].score;
  eq([w.fans.some((f) => f.name === "風牌"), w.totalFan], [false, 47],
    "②b 字一色＋大四喜：門清1+獨聽1+碰碰胡4+字一色16+三元牌1+大四喜16+五暗刻8=47，不加風牌", fanStr(r));
}
// ② 字一色、沒有四喜：照加風牌（南門風 1、東圈風 1）
{
  const r = ronSeat1("z1 z1 z1 z2 z2 z2 z5 z5 z5 z6 z6 z6 z3 z3 z3 z7", "z7");
  eq(r.winners![0].score.fans.filter((f) => f.name === "風牌").length, 2, "②c 字一色沒有四喜：東刻（圈風）＋南刻（門風）各 1 台風牌", fanStr(r));
}

// ③ 花槓 1 台：東家有春夏秋冬＋梅 → 本花 2（春、梅）＋花槓 1 = 3
{
  const hand = tiles("m1 m2 m3 m4 m5 m6 p7 p8 p9 s2 s3 s4 z4 z4 s5 s6");
  const win = t("s7");
  const score = calculateScore({
    concealed: [...hand, win], revealed: [], winTile: win, isSelfDraw: false, isDealer: false,
    seatWind: 1, prevalentWind: 1, flowers: tiles("f1 f2 f3 f4 f5"), isLastTile: false,
    isAfterKong: false, isRobbingKong: false, isFirstDraw: false,
  });
  const flowerFans = score.fans.filter((f) => ["正花", "春夏秋冬", "梅蘭菊竹"].includes(f.name));
  eq([flowerFans.map((f) => f.name + f.value), flowerFans.reduce((n, f) => n + f.value, 0)], [["正花2", "春夏秋冬1"], 3],
    "③ 東家春夏秋冬＋梅：本花 2＋花槓 1＝3 台");
}

// ④ 八仙過海：seat1 已有 7 張花，摸到第 8 張 → 立刻胡。連 2：閒家各付 100+8×20=260，
//    莊家另加莊家1+連2+拉2=5 台 → 100+13×20=360（2026-10 老闆：莊家台照付款雙方有莊家才加）
{
  const s = baseState();
  s.players[1].flowers = tiles(FLOWERS7);
  s.wall[0] = t("f8");
  const n = drawTile(s);
  eq([n.status, n.winners?.[0].seat, n.winners?.[0].score.fans.map((f) => f.name + f.value), calculateSettlement(n).deltas],
    ["finished", 1, ["八仙過海8", "莊家(斷)1", "連22", "拉22"], [-360, 880, -260, -260]], "④a 摸到第 8 張花：八仙過海，閒家各付 260、莊家付 360（連 2）");
}
// ④ 八仙過海也會在槓後補花時觸發
{
  const s = baseState();
  s.currentTurn = 1; s.hasDrawn = true; s.drawnTileId = 1;
  s.players[1].flowers = tiles(FLOWERS7);
  s.players[1].hand = tiles("m1 m2 m3 s1 s2 s3 s4 s5 s6 z2 z2 p5 p5 p5 p5 z6 z6");
  s.wall[s.wall.length - 1] = t("f8"); // 補牌從牌尾拿
  const n = executeConcealedKong(s, s.players[1].hand.filter((x) => x.display === "p5"));
  eq([n.status, n.winners?.[0].score.fans[0].name], ["finished", "八仙過海"], "④b 暗槓補到第 8 張花：也是八仙過海");
}
// ④ 七搶一（2026-10-22 改）：seat3 有 7 張花，seat1 摸到第 8 張 → 立刻成立，不再等 seat3 決定；只有 seat1 付
{
  const s = baseState();
  s.players[3].flowers = tiles(FLOWERS7);
  s.wall[0] = t("f8");
  const n = drawTile(s);
  eq([n.status, n.pendingFlowerRob ?? null, n.winners?.[0].seat, n.winners?.[0].from, n.winners?.[0].score.fans.map((f) => f.name + f.value), n.players[3].flowers.length, n.players[1].flowers.length, calculateSettlement(n).deltas],
    ["finished", null, 3, 1, ["七搶一8"], 8, 0, [0, -260, 0, 260]],
    "④c 別家摸到第 8 張花：立刻七搶一（不詢問），seat3 拿走那張花；只有 seat1 付 底 100＋8 台×20＝260，莊家 seat0 沒參與不加莊家台、也不用付");
}
// ④ 只有 7 張花、但第 8 張還沒出現：不觸發
{
  const s = baseState();
  s.players[3].flowers = tiles("f1 f2 f3 f4 f5 f6");
  s.wall[0] = t("f7");
  const n = drawTile(s);
  eq([n.status, n.pendingFlowerRob ?? null], ["playing", null], "④f 花總數還沒到 8 張：不觸發八仙或七搶一");
}

// ⑤ 剩 16 張不能槓
{
  const s = baseState(16);
  s.currentTurn = 1; s.hasDrawn = true; s.drawnTileId = 1;
  s.players[1].hand = tiles("m1 m2 m3 s1 s2 s3 s4 s5 s6 z2 z2 p5 p5 p5 p5 z6 z6");
  eq(canKongNow(s), false, "⑤a 牌牆 16 張：canKongNow=false");
  throws(() => executeConcealedKong(s, s.players[1].hand.filter((x) => x.display === "p5")), "⑤b 剩 16 張暗槓：擋下");
  eq(ownTurnActions(s, 1).map((a) => a.type).filter((x) => x !== "declare_eye"), [], "⑤c 剩 16 張：摸牌後不提供暗槓");

  const a = baseState(16);
  a.currentTurn = 1; a.hasDrawn = true; a.drawnTileId = 1;
  a.players[1].revealed = [meld("pong", "p5 p5 p5")];
  a.players[1].hand = tiles("m1 m2 m3 s1 s2 s3 s4 s5 s6 z2 z2 z2 z6 p5");
  throws(() => startAddKong(a, a.players[1].hand.find((x) => x.display === "p5")!), "⑤d 剩 16 張加槓：擋下");

  const m = baseState(16);
  m.players[2].hand = tiles("p5 p5 p5 m1 m2 m3 s1 s2 s3 z1 z1 z2 z2 z3 z3 z6");
  m.lastDiscard = { tile: t("p5"), from: 1 };
  eq(getAvailableActions(m).filter((x) => x.type === "kong").length, 0, "⑤e 剩 16 張：別人打的牌不提供明槓（碰照常）");
  throws(() => executeAction(m, { type: "kong", playerSeat: 2, tiles: m.players[2].hand.filter((x) => x.display === "p5") }), "⑤f 剩 16 張硬送明槓：擋下");

  const ok = baseState(17);
  ok.currentTurn = 1; ok.hasDrawn = true; ok.drawnTileId = 1;
  ok.players[1].hand = s.players[1].hand;
  eq(ownTurnActions(ok, 1).map((x) => x.type).filter((x) => x !== "declare_eye"), ["kong"], "⑤g 牌牆 17 張：還可以暗槓");
}

// ⑥ 摸牌後可做的動作（重新整理恢復按鈕）
{
  const s = baseState();
  s.players[1].revealed = [meld("pong", "p5 p5 p5")];
  s.players[1].hand = tiles("m1 m2 m3 s1 s2 s3 z2 z2 z2 p5 p6 z6 z6");
  s.wall[0] = t("p7");
  const n = drawTile(s); // 摸到 p7：可自摸（m1-3、s1-3、z2 刻、p5-7、z6 對＋碰 p5）、手上 p5 可加槓
  eq([ownTurnActions(n, 1).map((a) => a.type).filter((x) => x !== "declare_eye"), n.drawnTileId !== undefined], [["win", "add_kong"], true], "⑥a 摸牌後：自摸胡＋加槓", fanStr(n));
  eq(ownTurnActions(n, 2), [], "⑥b 不是自己的回合：沒有動作");
  const afterPong = { ...n, drawnTileId: undefined } as MahjongGameState;
  eq(ownTurnActions(afterPong, 1), [], "⑥c 吃碰後（這回合沒摸牌）：不給自摸／槓");
}

console.log(results.join("\n"));
if (results.some((r) => r.startsWith("❌"))) process.exit(1);
