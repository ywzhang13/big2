// 一炮多響的顯示（老闆 2026-10-22）：雙響只算離放槍者最近的下家，顯示、結算、統計都要是那一家，不管誰先按。
//   D1 順位後面的人先按：等待中不公開誰胡了（前端不會先跳「胡＋先按的人」）；結束後 state、事件、結算、統計都是順位第一那家
//   D2 順位前面的人先按：結果一樣
//   D3 三響：三家都胡、三家都收錢；winners 照順位排，winner（結算標題）是順位第一那家
//   D4 搶槓雙響：順位照加槓的人算
import { POST as action } from "../../app/api/mahjong/action/route";
import { POST as discard } from "../../app/api/mahjong/discard/route";
import { rooms } from "../support/stub-db";
import { sent } from "../support/stub-broadcast";
import { toPlayerGameState } from "../../lib/mahjong/db";
import type { MahjongGameState, Meld } from "../../lib/mahjong/gameState";
import type { Tile, TileSuit } from "../../lib/mahjong/tiles";
import { asSeat } from "../support/stub-auth";

let id = 60000;
const t = (k: string): Tile => ({ id: id++, suit: k[0] as TileSuit, rank: parseInt(k.slice(1), 10), display: k });
const tiles = (s: string) => s.split(" ").filter(Boolean).map(t);
const WIN_P5 = "m1 m2 m3 m4 m5 m6 m7 m8 m9 s1 s2 s3 z3 z3 z3 p5"; // 單吊五筒
const WIN_P5B = "p1 p2 p3 s4 s5 s6 s7 s8 s9 m2 m2 m2 z4 z4 z4 p5";
const WIN_P5C = "m1 m1 m1 s2 s3 s4 s6 s7 s8 m7 m8 m9 z1 z1 z1 p5";
const NOT = "m1 m1 m3 m4 m6 m7 m8 m9 s1 s3 s5 s7 s9 z1 z2 z6";
const results: string[] = [];
function eq(a: unknown, e: unknown, msg: string) {
  const ok = JSON.stringify(a) === JSON.stringify(e);
  results.push(`${ok ? "✅" : "❌"} ${msg}\n   預期=${JSON.stringify(e)} 實際=${JSON.stringify(a)}`);
}
function setup(hands: Record<number, string>, discarder = 2) {
  const s = { roomCode: "T", status: "playing",
    players: [0, 1, 2, 3].map((seat) => ({ id: "p" + seat, name: "P" + seat, seat, hand: tiles(hands[seat] ?? NOT), revealed: [] as Meld[], flowers: [] as Tile[], discards: [] as Tile[], isDealer: seat === 0 })),
    wall: tiles(Array(40).fill("m2").join(" ")), currentTurn: discarder, lastDiscard: null, dealerSeat: 0, doorSeat: 0, prevalentWind: 1, turnCount: 8,
    hasDrawn: true, isFirstRound: false, isAfterKong: false, stateVersion: 7,
    roomSettings: { totalRounds: 2, basePoints: 100, fanPoints: 20 }, roundInfo: { currentRound: 1, currentGame: 1, dealerConsecutive: 0, initialDealerSeat: 0 }, playerScores: [0, 0, 0, 0] } as unknown as MahjongGameState;
  const p5 = t("p5"); s.players[discarder].hand.push(p5); s.drawnTileId = p5.id;
  rooms.R = { id: "R", code: "T", game_state: s, status: "playing" }; sent.length = 0;
  return p5;
}
const call = async (fn: (r: Request) => Promise<Response>, body: object) => {
  const r = await fn(new Request("http://x", { method: "POST", headers: asSeat({ roomId: "R", ...body }), body: JSON.stringify({ roomId: "R", ...body }) }));
  return { status: r.status, body: await r.json() };
};
const st = () => rooms.R.game_state as MahjongGameState;
const summary = () => {
  const s = st(); const over = sent.find((e) => e.event === "mj_game_over")?.payload as { winnerSeat: number; winnerName: string; winners: { seat: number }[] } | undefined;
  return { status: s.status, winner: s.winner?.seat, winners: s.winners?.map((w) => w.seat), eventSeat: over?.winnerSeat, eventName: over?.winnerName, eventWinners: over?.winners.map((w) => w.seat),
    deltas: s.settlement?.deltas, wins: s.handStats?.wins, dealIns: s.handStats?.dealIns, scores: s.playerScores };
};

// D1／D2 雙響：seat2 打出五筒，seat3（順位第一）和 seat1（順位第三）都能胡
for (const [label, first, second] of [["D1 順位後面的 seat1 先按", "p1", "p3"], ["D2 順位前面的 seat3 先按", "p3", "p1"]] as const) {
  const p5 = setup({ 1: WIN_P5, 3: WIN_P5B });
  await call(discard, { playerId: "p2", tileId: p5.id });
  const a = await call(action, { playerId: first, actionType: "win" });
  const views = ["p0", "p1", "p2", "p3"].map((pid) => toPlayerGameState(st(), pid));
  eq([a.body.partial, st().status, views.map((v) => [v.winner ?? null, v.winners ?? null])], [true, "playing", Array(4).fill([null, null])],
    `${label}：等待另一家時，四家的牌局狀態都不公開誰胡了（前端不會先跳「胡＋${first === "p1" ? "P1" : "P3"}」）`);
  await call(action, { playerId: second, actionType: "win" });
  eq(summary(), { status: "finished", winner: 3, winners: [3], eventSeat: 3, eventName: "P3", eventWinners: [3], deltas: [0, 0, -160, 160], wins: [0, 0, 0, 1], dealIns: [0, 0, 1, 0], scores: [0, 0, -160, 160] },
    `${label}、${second === "p3" ? "seat3" : "seat1"} 後按：state.winner、winners、mj_game_over 都是順位第一的 seat3（P3）；只有 seat3 收錢、整場統計記 seat3 胡、seat2 放槍`);
}

// D3 三響：seat3、seat0、seat1 都胡（順位 seat3 → seat0 → seat1），seat1 最先按
{
  const p5 = setup({ 0: WIN_P5C, 1: WIN_P5, 3: WIN_P5B });
  await call(discard, { playerId: "p2", tileId: p5.id });
  for (const pid of ["p1", "p0", "p3"]) await call(action, { playerId: pid, actionType: "win" });
  const s = summary();
  eq([s.status, s.winner, s.winners, s.eventSeat, s.eventWinners, s.deltas!.filter((d) => d > 0).length, s.deltas![2] < 0, s.wins],
    ["finished", 3, [3, 0, 1], 3, [3, 0, 1], 3, true, [1, 1, 0, 1]],
    "D3 三響（seat1 最先按）：三家都胡、都收錢；winners 照順位 [3,0,1]，結算標題是 seat3");
}

// D5 三響的等待廣播（審伯 2026-10-22）：seat1 先按、seat3 第二個按、seat0 還沒決定；
//   winners 照順位排成 [3,1]，第二次 mj_partial_win 要是 seat3 自己的分數，不能拿排在最後的 seat1
{
  const p5 = setup({ 0: WIN_P5C, 1: WIN_P5, 3: WIN_P5B });
  await call(discard, { playerId: "p2", tileId: p5.id });
  await call(action, { playerId: "p1", actionType: "win" });
  sent.length = 0;
  const r = await call(action, { playerId: "p3", actionType: "win" });
  const pw = sent.filter((e) => e.event === "mj_partial_win").map((e) => e.payload as { seat: number; winnerName: string; score: { total: number } });
  const own = (seat: number) => st().winners!.find((w) => w.seat === seat)!.score;
  eq([r.body.partial, st().status, st().winners!.map((w) => w.seat), pw.length, pw[0]?.seat, pw[0]?.winnerName, JSON.stringify(pw[0]?.score) === JSON.stringify(own(3)), JSON.stringify(own(3)) !== JSON.stringify(own(1))],
    [true, "playing", [3, 1], 1, 3, "P3", true, true],
    "D5 三響 seat1 先按、seat3 第二個按（seat0 未決定）：第二次 mj_partial_win 是 seat3（P3）和 seat3 自己的分數（兩家分數不同，拿錯會被抓到）");
}

// D4 搶槓雙響：seat2 加槓五筒，seat3（順位第一）和 seat1 都能搶；seat1 先按
{
  setup({ 1: WIN_P5, 3: WIN_P5B });
  const s = st();
  s.players[2].hand = tiles("m1 m2 m3 s1 s2 s3 s4 s5 s6 z2 z2 z2 z6 p5"); s.players[2].revealed = [{ type: "pong", tiles: tiles("p5 p5 p5") }];
  s.drawnTileId = s.players[2].hand.at(-1)!.id;
  await call(action, { playerId: "p2", actionType: "add_kong", tiles: [s.players[2].hand.at(-1)!.id] });
  await call(action, { playerId: "p1", actionType: "win" });
  await call(action, { playerId: "p3", actionType: "win" });
  const r = summary();
  eq([r.status, r.winner, r.winners, r.eventSeat, r.deltas![3] > 0, r.deltas![1], r.deltas![2] < 0], ["finished", 3, [3], 3, true, 0, true],
    "D4 搶槓雙響（seat1 先按）：照加槓的 seat2 算順位，顯示和收錢都是 seat3");
}

console.log(results.join("\n"));
if (results.some((r) => r.startsWith("❌"))) process.exit(1);
process.exit(0);
