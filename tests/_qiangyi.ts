// 七搶一（老闆 2026-10-22）：場上一家剛好 7 張花、另一家剛好 1 張，就立刻成立、這局結束，不再詢問；
// 只有那 1 張花的人付「底＋8 台」給 7 張的人；莊家台照放槍的原則（莊家胡、或付錢的是莊家才加）；不算自摸。
//   Q1 順序 A：7 張那家先有，別家摸到（第 8 張）花 → 成立
//   Q2 順序 B（原本的 bug）：1 張那家先有，另一家後來湊到第 7 張 → 也成立（原本不會觸發）
//   Q3 開局補花完就 7＋1 → 成立；暗槓補牌補到花也會觸發
//   Q4 付款：只有 1 張那家付；閒家對閒家 8 台；莊家胡加莊家＋連拉；1 張那家是莊家加莊家(斷)＋連拉；不相干的莊家不付
//   Q5 不算自摸：isSelfDrawWin 否、整場統計的自摸次數不加；從 1 張那家的放槍欄記
//   Q6 八仙過海不變：三家都付、算自摸
//   Q7 不會誤觸發：6＋2、7＋0、摸到不是花的牌
import { calculateSettlement, checkDealFlowerWin, drawTile, executeConcealedKong, isSelfDrawWin, tallyHandStats } from "../lib/mahjong/gameLogic";
import type { MahjongGameState, Meld } from "../lib/mahjong/gameState";
import type { Tile, TileSuit } from "../lib/mahjong/tiles";

const results: string[] = [];
function eq(a: unknown, e: unknown, msg: string) {
  const ok = JSON.stringify(a) === JSON.stringify(e);
  results.push(`${ok ? "✅" : "❌"} ${msg}${ok ? "" : `\n   預期=${JSON.stringify(e)}\n   實際=${JSON.stringify(a)}`}`);
}
let nextId = 8000;
const t = (k: string): Tile => ({ id: nextId++, suit: k[0] as TileSuit, rank: parseInt(k.slice(1), 10), display: k });
const tiles = (s: string) => s.split(" ").filter(Boolean).map(t);
/** 莊家 seat0、輪到 seat1 摸牌；flowers：每家的花 */
function game(flowers: Record<number, string>, consecutive = 0, wallFront = "m9"): MahjongGameState {
  const wall = tiles(Array(40).fill("m9").join(" "));
  wall[0] = t(wallFront);
  return {
    roomCode: "T", status: "playing",
    players: [0, 1, 2, 3].map((seat) => ({ id: "p" + seat, name: "P" + seat, seat, hand: tiles("m1 m1 m3 m4 m6 m7 m8 m9 s1 s3 s5 s9 z1 z2 z3 z6"),
      revealed: [] as Meld[], flowers: tiles(flowers[seat] ?? ""), discards: [] as Tile[], isDealer: seat === 0 })),
    wall, currentTurn: 1, lastDiscard: null, dealerSeat: 0, doorSeat: 0, prevalentWind: 1, turnCount: 8, hasDrawn: false, isFirstRound: false, isAfterKong: false,
    roomSettings: { totalRounds: 2, basePoints: 100, fanPoints: 20 },
    roundInfo: { currentRound: 1, currentGame: 1, dealerConsecutive: consecutive, initialDealerSeat: 0 }, playerScores: [0, 0, 0, 0],
  } as unknown as MahjongGameState;
}
const brief = (s: MahjongGameState) => {
  const w = s.winners?.[0];
  return { status: s.status, pending: s.pendingFlowerRob ?? null, seat: w?.seat ?? null, from: w?.from ?? null, fans: w?.score.fans.map((f) => f.name + f.value) ?? [],
    flowers: s.players.map((p) => p.flowers.length), deltas: s.status === "finished" ? calculateSettlement(s).deltas : null };
};

// Q1 順序 A
eq(brief(drawTile(game({ 3: "f1 f2 f3 f4 f5 f6 f7" }, 0, "f8"))),
  { status: "finished", pending: null, seat: 3, from: 1, fans: ["七搶一8"], flowers: [0, 0, 0, 8], deltas: [0, -260, 0, 260] },
  "Q1 順序 A：seat3 先有 7 張，seat1 摸到第 8 張花 → 立刻七搶一；seat3 拿走那張花，只有 seat1 付 底 100＋8×20＝260");

// Q2 順序 B（bug）
const before = game({ 1: "f8", 2: "f1 f2 f3 f4 f5 f6" }, 0, "f7");
before.currentTurn = 2;
eq(brief(drawTile(before)),
  { status: "finished", pending: null, seat: 2, from: 1, fans: ["七搶一8"], flowers: [0, 0, 8, 0], deltas: [0, -260, 260, 0] },
  "Q2 順序 B：seat1 先有 1 張，seat2 後來摸到第 7 張 → 也立刻七搶一（原本不會觸發），只有 seat1 付 260");

// Q3 開局、暗槓補花
{
  const s = game({ 3: "f1 f2 f3 f4 f5 f6 f7", 2: "f8" });
  s.currentTurn = 0; s.hasDrawn = true;
  eq(brief(checkDealFlowerWin(s)),
    { status: "finished", pending: null, seat: 3, from: 2, fans: ["七搶一8"], flowers: [0, 0, 0, 8], deltas: [0, 0, -260, 260] },
    "Q3a 開局補花完 seat3 7 張、seat2 1 張 → 立刻七搶一，莊家不用先打牌；只有 seat2 付");
  const k = game({ 1: "f1 f2 f3 f4 f5 f6", 3: "f8" });
  k.hasDrawn = true; k.players[1].hand = tiles("m1 m2 m3 s1 s2 s3 s4 s5 s6 z2 z2 p5 p5 p5 p5 z6 z6"); k.drawnTileId = k.players[1].hand[16].id;
  k.wall[k.wall.length - 1] = t("f7"); // 暗槓補牌從牌尾拿
  eq(brief(executeConcealedKong(k, k.players[1].hand.filter((x) => x.display === "p5"))).seat, 1,
    "Q3b 打牌中 seat1 暗槓、補牌補到第 7 張花（seat3 早就有 1 張）→ 也立刻七搶一");
}

// Q4 付款與莊家台
eq(brief(drawTile(game({ 0: "f1 f2 f3 f4 f5 f6 f7" }, 1, "f8"))).deltas, [320, -320, 0, 0],
  "Q4a 莊家 seat0 七搶一（連 1）：照放槍加 莊家1＋連1＋拉1＝11 台，只有 seat1 付 100＋11×20＝320");
{
  const s = game({ 0: "f8", 3: "f1 f2 f3 f4 f5 f6" }, 1, "f7"); s.currentTurn = 3;
  const r = brief(drawTile(s));
  eq([r.fans, r.deltas], [["七搶一8", "莊家(斷)1", "連11", "拉11"], [-320, 0, 0, 320]],
    "Q4b 1 張花的是莊家 seat0（連 1）：照放槍加 莊家(斷)1＋連1＋拉1，莊家付 320");
}
eq(brief(drawTile(game({ 3: "f1 f2 f3 f4 f5 f6 f7" }, 2, "f8"))).deltas, [0, -260, 0, 260],
  "Q4c 閒家對閒家（連 2）：莊家沒參與，不加莊家台、也不用付；seat1 付 260");

// Q5 不算自摸
{
  const s = drawTile(game({ 3: "f1 f2 f3 f4 f5 f6 f7" }, 0, "f8"));
  tallyHandStats(s);
  eq([isSelfDrawWin(s.winners![0]), s.handStats], [false, { wins: [0, 0, 0, 1], dealIns: [0, 1, 0, 0], selfDraws: [0, 0, 0, 0] }],
    "Q5 七搶一不算自摸：isSelfDrawWin 否（斗內自摸次數共用）、整場統計自摸 0；付錢的 seat1 記在放槍欄");
}

// Q6 八仙過海不變
{
  const s = drawTile(game({ 1: "f1 f2 f3 f4 f5 f6 f7" }, 0, "f8"));
  tallyHandStats(s);
  eq([brief(s).fans, brief(s).deltas, isSelfDrawWin(s.winners![0]), s.handStats!.selfDraws], [["八仙過海8", "莊家(斷)1"], [-280, 800, -260, -260], true, [0, 1, 0, 0]],
    "Q6 八仙過海不變：閒家 seat1 八仙，三家都付（莊家 280、閒家 260），算自摸");
}

// Q7 不會誤觸發
eq([brief(drawTile(game({ 3: "f1 f2 f3 f4 f5 f6", 2: "f7" }, 0, "f8"))).status, brief(drawTile(game({ 3: "f1 f2 f3 f4 f5 f6 f7" }, 0, "m2"))).status,
  brief(checkDealFlowerWin(game({ 3: "f1 f2 f3 f4 f5 f6", 1: "f7 f8" }))).status],
  ["playing", "playing", "playing"], "Q7 6＋2（第 8 張出現但沒有 7＋1）、7＋0（摸到一般牌）、開局 6＋2：都不觸發");

console.log(results.join("\n"));
if (results.some((r) => r.startsWith("❌"))) process.exit(1);
