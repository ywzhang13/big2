// 老闆 2026-10-17：
//   ⑥ 上家打出的牌不能明槓（只能碰或吃）；對家、上家以外的別家照樣可以明槓；暗槓不受影響
//   ⑤ 整場統計：每家胡牌、放槍、自摸次數。一砲多響每個胡的人各算一次胡、放槍的人只算一次；
//      雙響只有一家真的胡（和結算一致）；八仙過海照結算算自摸、七搶一記在付錢的人；整場打完才公開
import { POST as discard } from "../../app/api/mahjong/discard/route";
import { POST as action } from "../../app/api/mahjong/action/route";
import { rooms } from "../support/stub-db";
import { sent } from "../support/stub-broadcast";
import { toPublicGameState } from "../../lib/mahjong/db";
import { getAvailableActions, startNextGame, tallyHandStats } from "../../lib/mahjong/gameLogic";
import { gameOverEvent } from "../../lib/mahjong/events";
import { paceClock } from "../../lib/mahjong/pace";
import type { MahjongGameState, Meld, WinnerEntry } from "../../lib/mahjong/gameState";
import type { Tile, TileSuit } from "../../lib/mahjong/tiles";
import { asSeat } from "../support/stub-auth";

paceClock.sleep = async () => {}; // 這支不測節奏，不真的等

let nextId = 97000;
const t = (k: string): Tile => ({ id: nextId++, suit: k[0] as TileSuit, rank: parseInt(k.slice(1), 10), display: k });
const tiles = (s: string) => s.split(" ").filter(Boolean).map(t);
const NOT_WAIT = "m1 m1 m3 m4 m6 m7 m8 m9 s1 s3 s5 s9 z1 z2 z3 z6";
const P5x3 = "p5 p5 p5 m1 m3 m4 m6 m8 m9 s1 s3 s9 z1 z2 z3 z6"; // 有三張五筒
const WAIT25 = "m3 m4 p1 p2 p3 p4 p5 p6 p7 p8 p9 s1 s2 s3 z1 z1"; // 聽二五萬

function setup(hands: Record<number, string> = {}, mut?: (s: MahjongGameState) => void) {
  const s = {
    roomCode: "T", status: "playing",
    players: [0, 1, 2, 3].map((seat) => ({ id: "p" + seat, name: "P" + seat, seat, hand: tiles(hands[seat] ?? NOT_WAIT), revealed: [] as Meld[], flowers: [] as Tile[], discards: tiles("z7"), isDealer: seat === 0 })),
    wall: tiles(Array(40).fill("m9").join(" ")), currentTurn: 0, lastDiscard: null, dealerSeat: 0, doorSeat: 0,
    prevalentWind: 1, turnCount: 8, hasDrawn: false, isFirstRound: false, isAfterKong: false, stateVersion: 2,
    roomSettings: { totalRounds: 1, basePoints: 100, fanPoints: 20 },
    roundInfo: { currentRound: 1, currentGame: 1, dealerConsecutive: 0, initialDealerSeat: 0 }, playerScores: [0, 0, 0, 0],
  } as MahjongGameState;
  mut?.(s);
  rooms.R = { id: "R", code: "T", game_state: s, status: "playing" };
  sent.length = 0;
}
async function call(fn: (r: Request) => Promise<Response>, body: object) {
  const r = await fn(new Request("http://x", { method: "POST", headers: asSeat({ roomId: "R", ...body }), body: JSON.stringify({ roomId: "R", ...body }) }));
  return { status: r.status, body: await r.json() };
}
const st = () => rooms.R.game_state as MahjongGameState;
const results: string[] = [];
function eq(a: unknown, e: unknown, msg: string) {
  const ok = JSON.stringify(a) === JSON.stringify(e);
  results.push(`${ok ? "✅" : "❌"} ${msg}\n   預期=${JSON.stringify(e)} 實際=${JSON.stringify(a)}`);
}
/** seat 摸進 key 後打出它 */
async function giveAndDiscard(seat: number, key: string) {
  const s = st(); const tile = t(key);
  s.players[seat].hand.push(tile);
  s.currentTurn = seat; s.hasDrawn = true; s.drawnTileId = tile.id; s.lastDiscard = null; s.pendingActions = undefined;
  sent.length = 0;
  return call(discard, { playerId: "p" + seat, tileId: tile.id });
}
const ids = (seat: number, key: string, n: number) => st().players[seat].hand.filter((x) => x.display === key).slice(0, n).map((x) => x.id);
const kinds = (seat: number) => getAvailableActions(st()).filter((a) => a.playerSeat === seat).map((a) => a.type);

// ===================== ⑥ 上家打的牌不能明槓 =====================
{
  setup({ 1: P5x3 });
  await giveAndDiscard(0, "p5"); // seat0 是 seat1 的上家
  eq(kinds(1), ["pong"], "K1 上家打五筒、下家有三張：只能碰，沒有明槓選項");
  const k = await call(action, { playerId: "p1", actionType: "kong", tiles: ids(1, "p5", 3) });
  eq([k.status, k.body.error, st().players[1].revealed.length], [400, "上家打的牌不能明槓，可以碰", 0], "K2 硬送明槓：伺服器擋下（400），沒有槓出去");
  const p = await call(action, { playerId: "p1", actionType: "pong", tiles: ids(1, "p5", 2) });
  eq([p.status, st().players[1].revealed[0]?.type, st().currentTurn], [200, "pong", 1], "K3 改成碰：照常成功");
}
{
  setup({ 2: P5x3 });
  await giveAndDiscard(0, "p5"); // seat2 是 seat0 的對家
  eq(kinds(2), ["kong", "pong"], "K4 對家打的牌：照樣可以明槓");
  const k = await call(action, { playerId: "p2", actionType: "kong", tiles: ids(2, "p5", 3) });
  eq([k.status, st().players[2].revealed[0]?.type], [200, "kong"], "K5 對家的牌明槓成功");
}
{
  setup({ 3: P5x3 });
  await giveAndDiscard(0, "p5"); // seat3 是 seat0 的上家（打牌者的下下下家）
  eq(kinds(3), ["kong", "pong"], "K6 下家打的牌（我是他的上家）：照樣可以明槓");
}
{
  setup({ 1: "p5 p5 p5 p5 m1 m3 m4 m6 m8 m9 s1 s3 s9 z1 z2 z3" }, (s) => { s.currentTurn = 1; s.hasDrawn = true; s.drawnTileId = 1; });
  const k = await call(action, { playerId: "p1", actionType: "kong", tiles: ids(1, "p5", 4) });
  eq([k.status, st().players[1].revealed[0]?.type], [200, "concealed_kong"], "K7 暗槓不受影響");
}

// ===================== ⑤ 整場統計 =====================
const w = (seat: number, from: number | null, fan = "平胡"): WinnerEntry => ({ seat, from, score: { fans: [{ name: fan, value: 1 }], totalFan: 1 } });
function tally(winners: WinnerEntry[], lastFrom?: number, start?: MahjongGameState["handStats"]) {
  const s = { winners, winner: winners[0], lastDiscard: lastFrom === undefined ? null : { tile: t("m2"), from: lastFrom }, handStats: start } as unknown as MahjongGameState;
  tallyHandStats(s);
  return s.handStats;
}
eq(tally([w(1, null, "自摸")]), { wins: [0, 1, 0, 0], dealIns: [0, 0, 0, 0], selfDraws: [0, 1, 0, 0] }, "S1 自摸：胡 1、自摸 1，沒有人放槍");
eq(tally([w(2, 0)], 0), { wins: [0, 0, 1, 0], dealIns: [1, 0, 0, 0], selfDraws: [0, 0, 0, 0] }, "S2 放槍：胡的人胡 1，放槍的人放槍 1");
eq(tally([w(1, 0), w(2, 0), w(3, 0)], 0), { wins: [0, 1, 1, 1], dealIns: [1, 0, 0, 0], selfDraws: [0, 0, 0, 0] }, "S3 一砲三響：三家各胡 1，放槍的人只算 1 次");
eq(tally([w(3, 0), w(1, 0)], 0), { wins: [0, 1, 0, 0], dealIns: [1, 0, 0, 0], selfDraws: [0, 0, 0, 0] }, "S4 雙響：和結算一樣只有離放槍最近的下家胡（seat1），另一家不算");
eq(tally([], undefined), { wins: [0, 0, 0, 0], dealIns: [0, 0, 0, 0], selfDraws: [0, 0, 0, 0] }, "S5 流局：都不加");
eq([tally([w(2, null, "八仙過海")]), tally([w(3, 1, "七搶一")])],
  [{ wins: [0, 0, 1, 0], dealIns: [0, 0, 0, 0], selfDraws: [0, 0, 1, 0] }, { wins: [0, 0, 0, 1], dealIns: [0, 1, 0, 0], selfDraws: [0, 0, 0, 0] }],
  "S6 八仙過海三家付算自摸；七搶一（2026-10-22 改）只有 1 張花的人付，不算自摸，照付款記在那 1 張花的人（放槍欄）");
eq(tally([w(2, 0)], 0, { wins: [3, 1, 0, 2], dealIns: [1, 2, 0, 0], selfDraws: [1, 0, 0, 1] }),
  { wins: [3, 1, 1, 2], dealIns: [2, 2, 0, 0], selfDraws: [1, 0, 0, 1] }, "S7 跨局累加：在之前的次數上加");

// 走真的 API：seat0 打二萬放槍給 seat2 → 這局結算記進統計；只有 1 圈且下莊→整場打完 → 公開狀態、mj_game_over 都帶 handStats
{
  setup({ 2: WAIT25 }, (s) => { s.roundInfo = { currentRound: 1, currentGame: 4, dealerConsecutive: 0, initialDealerSeat: 1 }; s.handStats = { wins: [1, 0, 0, 0], dealIns: [0, 0, 1, 0], selfDraws: [1, 0, 0, 0] }; });
  await giveAndDiscard(0, "m2");
  const ref = rooms.R; // 整場打完會關房（從 rooms 刪掉），先留住最後存的狀態
  const hu = await call(action, { playerId: "p2", actionType: "win" });
  const s = ref.game_state as MahjongGameState;
  const ev = sent.find((e) => e.event === "mj_game_over")?.payload as { handStats?: unknown; gameOver?: boolean } | undefined;
  eq([hu.status, s.status, s.gameOver, s.handStats], [200, "finished", true, { wins: [1, 0, 1, 0], dealIns: [1, 0, 1, 0], selfDraws: [1, 0, 0, 0] }],
    "S8 真的打一手放槍胡（最後一局、莊家下莊→整場打完）：統計加上 seat2 胡 1、seat0 放槍 1");
  eq([toPublicGameState(s).handStats, ev?.gameOver, ev?.handStats], [s.handStats, true, s.handStats], "S9 整場打完：公開狀態和 mj_game_over 都帶 handStats");
}
{
  setup({ 2: WAIT25 });
  await giveAndDiscard(0, "m2");
  await call(action, { playerId: "p2", actionType: "win" });
  const s = st();
  const ev = sent.find((e) => e.event === "mj_game_over")?.payload as { handStats?: unknown } | undefined;
  const next = startNextGame(s);
  eq([s.gameOver, toPublicGameState(s).handStats, ev?.handStats, next.handStats], [false, undefined, undefined, s.handStats],
    "S10 還沒打完：公開狀態和廣播都不帶；下一局照樣留著繼續累加");
}

console.log(results.join("\n"));
if (results.some((r) => r.startsWith("❌"))) process.exit(1);
