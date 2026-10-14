// 加槓 + 搶槓胡（2026-10 老闆確認：只有加槓能被搶，搶槓胡 1 台，由加槓者照放槍付）。
// 共同設定：底 100、每台 20、dealer=seat 0、doorSeat=0、圈風東、連莊 0。
// 加槓者預設 seat 2：已碰 5 筒，手上摸到第 4 張 5 筒。
import {
  canAddKong, startAddKong, completeAddKong, getAvailableActions,
  declareWin, applyWinnerOrderRule, calculateSettlement, executeConcealedKong,
} from "../lib/mahjong/gameLogic";
import type { MahjongGameState, Meld } from "../lib/mahjong/gameState";
import type { Tile, TileSuit } from "../lib/mahjong/tiles";

let nextId = 2000;
function t(key: string): Tile {
  return { id: nextId++, suit: key[0] as TileSuit, rank: parseInt(key.slice(1), 10), display: key };
}
const tiles = (keys: string) => keys.split(" ").filter(Boolean).map(t);
const meld = (type: Meld["type"], keys: string): Meld => ({ type, tiles: tiles(keys) });

// 16 張手牌
const W_MID = "m1 m2 m3 m4 m5 m6 m7 m8 m9 s1 s2 s3 z1 z1 p4 p6";    // 中洞聽 5 筒：門清1+獨聽1
const W_TWO = "m1 m2 m3 m4 m5 m6 s4 s5 s6 s7 s8 s9 z4 z4 p3 p4";    // 聽 2/5 筒：門清1
const W_SINGLE = "m1 m2 m3 m4 m5 m6 m7 m8 m9 s1 s2 s3 z3 z3 z3 p5"; // 單吊 5 筒：門清1+獨聽1
const NOT_WAIT = "m1 m1 m3 m4 m6 m7 m8 m9 s1 s3 s5 s7 s9 z1 z2 z3"; // 不聽 5 筒
const NOT_WAIT_CHI = "m1 m1 m3 m4 m6 m7 m8 m9 s1 s3 s5 s7 s9 z1 p3 p4"; // 不能胡，但可「吃」5 筒

function baseState(kongSeat: number, others: Record<number, string>): MahjongGameState {
  const s = {
    roomCode: "TEST", status: "playing",
    players: [0, 1, 2, 3].map((seat) => ({
      id: "p" + seat, name: "P" + seat, seat,
      hand: tiles(others[seat] ?? NOT_WAIT), revealed: [] as Meld[], flowers: [],
      discards: [t("m9")], isDealer: seat === 0,
    })),
    wall: tiles(Array(40).fill("m1").join(" ")),
    currentTurn: kongSeat, lastDiscard: null, dealerSeat: 0, doorSeat: 0, prevalentWind: 1,
    turnCount: 8, hasDrawn: true, isFirstRound: false, isAfterKong: false,
    roomSettings: { totalRounds: 1, basePoints: 100, fanPoints: 20 },
    roundInfo: { currentRound: 1, currentGame: 1, dealerConsecutive: 0, initialDealerSeat: 0 },
    playerScores: [0, 0, 0, 0],
  } as MahjongGameState;
  const k = s.players[kongSeat];
  k.revealed = [meld("pong", "p5 p5 p5")];
  k.hand = tiles("m1 m2 m3 s1 s2 s3 s4 s5 s6 z2 z2 z2 z6 p5"); // 13 + 摸到的 5 筒
  return s;
}
const kongTile = (s: MahjongGameState, seat: number) => s.players[seat].hand.find((x) => x.display === "p5")!;

/** 搶槓：robbers 依序宣告胡，然後照一砲多響規則結算 */
function rob(s: MahjongGameState, robbers: number[]) {
  for (const r of robbers) s = declareWin(s, r, false);
  s = applyWinnerOrderRule(s);
  return { state: s, settle: calculateSettlement(s) };
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

// K1 可以加槓的牌
{
  const s = baseState(2, {});
  eq(canAddKong(s.players[2]).map((x) => x.display), ["p5"], "K1 已碰 5 筒、手上有 5 筒：可以加槓 5 筒");
  eq(canAddKong(s.players[1]).length, 0, "K1b 沒碰過的玩家：不能加槓");
}
// K2 加槓的防呆
{
  const s = baseState(2, {});
  throws(() => startAddKong(s, s.players[2].hand[0]), "K2a 用不是已碰的牌加槓：擋下");
  const s2 = baseState(2, {}); s2.hasDrawn = false;
  throws(() => startAddKong(s2, kongTile(s2, 2)), "K2b 還沒摸牌就加槓：擋下");
}
// K3 沒人能搶：直接完成加槓並補一張
{
  const s = baseState(2, {});
  const n = startAddKong(s, kongTile(s, 2));
  const p = n.players[2];
  eq([n.pendingAddKong ?? null, p.revealed[0].type, p.revealed[0].tiles.length, p.hand.length, n.wall.length, n.isAfterKong, n.currentTurn, n.hasDrawn],
    [null, "kong", 4, 14, 39, true, 2, true], "K3 沒人能搶：碰升成槓（4 張）、補 1 張（手牌仍 14、牌牆 40→39）、可槓上開花、輪到自己打牌");
}
// K4 一家能搶：開窗口；窗口中其他人不能吃碰
{
  const s = baseState(2, { 1: W_MID, 3: NOT_WAIT_CHI });
  const n = startAddKong(s, kongTile(s, 2));
  eq([n.pendingAddKong?.seat, n.lastDiscard?.from, n.pendingActions?.potentialActors, n.players[2].hand.length, n.players[2].revealed[0].type],
    [2, 2, [1], 13, "pong"], "K4a 只有 seat1 能胡：開搶槓窗口，只等 seat1；加槓者手牌 13、還是碰");
  eq(getAvailableActions(n).map((a) => `${a.playerSeat}:${a.type}`), ["1:win"], "K4b 窗口中只有胡，seat3 原本能吃也不給吃");

  const r = rob(n, [1]);
  eq(r.settle.deltas, [0, 160, -160, 0], "K4c 有人搶：seat1 門清1+獨聽1+搶槓胡1=3 台，加槓者 seat2 付 160", fanStr(r.state));

  const c = completeAddKong(n);
  eq([c.pendingAddKong ?? null, c.pendingActions ?? null, c.lastDiscard, c.players[2].revealed[0].type, c.players[2].hand.length, c.wall.length, c.currentTurn],
    [null, null, null, "kong", 14, 39, 2], "K4d 沒人搶（全部 pass）：完成加槓並補牌，輪到加槓者");
}
// K5 莊家加槓被搶：套莊家台原則
{
  const s = baseState(0, { 1: W_MID });
  const n = startAddKong(s, kongTile(s, 0));
  const r = rob(n, [1]);
  eq(r.settle.deltas, [-180, 180, 0, 0], "K5 莊家加槓被閒家搶：3+莊家(斷)1=4 台，莊家付 180", fanStr(r.state));
}
// K6 莊家搶閒家的槓
{
  const s = baseState(2, { 0: W_MID });
  const n = startAddKong(s, kongTile(s, 2));
  const r = rob(n, [0]);
  eq(r.settle.deltas, [180, 0, -180, 0], "K6 莊家搶閒家的槓：莊家1+門清1+獨聽1+搶槓胡1=4 台，加槓者付 180", fanStr(r.state));
}
// K7 兩家能搶（雙響）：只算離加槓者最近的下家
{
  const s = baseState(2, { 1: W_MID, 3: W_TWO });
  const n = startAddKong(s, kongTile(s, 2));
  eq(n.pendingActions?.potentialActors.slice().sort(), [1, 3], "K7a 兩家能搶：窗口等 seat1、seat3");
  const r = rob(n, [1, 3]);
  eq(r.settle.deltas, [0, 0, -140, 140], "K7b 雙響：只有 seat3（加槓者下家）胡，門清1+搶槓胡1=2 台", fanStr(r.state));
}
// K8 三家能搶（三響）：三家都胡，加槓者分別付
{
  const s = baseState(2, { 0: W_SINGLE, 1: W_MID, 3: W_TWO });
  const n = startAddKong(s, kongTile(s, 2));
  const r = rob(n, [3, 0, 1]);
  eq(r.settle.deltas, [180, 160, -480, 140], "K8 三響：莊家 4 台 180、seat1 3 台 160、seat3 2 台 140，加槓者付 480", fanStr(r.state));
}
// K9 暗槓不能被搶（明槓同理：都不會開搶槓窗口）
{
  const s = baseState(2, { 1: W_MID });
  s.players[2].revealed = [];
  s.players[2].hand = tiles("m1 m2 m3 s1 s2 s3 s4 s5 s6 z2 z2 p5 p5 p5 p5 z6 z6");
  const n = executeConcealedKong(s, s.players[2].hand.filter((x) => x.display === "p5"));
  eq([n.pendingAddKong ?? null, n.lastDiscard, n.players[2].revealed[0].type], [null, null, "concealed_kong"], "K9 暗槓：不開搶槓窗口，別人不能搶");
}

console.log(results.join("\n"));
if (results.some((r) => r.startsWith("❌"))) process.exit(1);
