// 最後一局莊家留莊：莊家胡（自摸、放槍、一砲多響裡有莊家）或流局 → 照連莊規則繼續打，莊家下莊才整場結束；閒家胡照常結束。
// 整場最終結算的分數、對局紀錄、handsCompleted 都要照實。
import { POST as discard } from "../../app/api/mahjong/discard/route";
import { POST as draw } from "../../app/api/mahjong/draw/route";
import { POST as action } from "../../app/api/mahjong/action/route";
import { POST as nextGame } from "../../app/api/mahjong/next-game/route";
import { rooms } from "../support/stub-db";
import { sent } from "../support/stub-broadcast";
import * as rs from "../support/stub-records-store";
import type { MahjongGameState, Meld } from "../../lib/mahjong/gameState";
import type { Tile, TileSuit } from "../../lib/mahjong/tiles";
import { asSeat } from "../support/stub-auth";

let nextId = 95000;
const t = (k: string): Tile => ({ id: nextId++, suit: k[0] as TileSuit, rank: parseInt(k.slice(1), 10), display: k });
const tiles = (s: string) => s.split(" ").filter(Boolean).map(t);
const H16 = "m1 m2 m3 m4 m5 m6 p7 p8 p9 s2 s3 s4 z4 z4 s5 s6"; // 聽 1/4/7 條
const NOT_WAIT = "m1 m1 m3 m4 m6 m7 m8 m9 s1 s3 s5 s9 z1 z2 z3 z6";
const DEALER = 3; // 1 圈的第 4 局：起莊 seat0，這局莊家是 seat3

/** 1 圈的房，已打完 handsCompleted 局；last=true 是第 4 局（最後一局） */
function room(id: string, last = true, dealer = DEALER) {
  const s = {
    roomCode: id, status: "playing",
    players: [0, 1, 2, 3].map((seat) => ({ id: `p${seat}`, name: `玩家${seat + 1}`, seat, hand: tiles(NOT_WAIT), revealed: [] as Meld[], flowers: [] as Tile[], discards: [t("m9")], isDealer: seat === dealer })),
    wall: tiles(Array(40).fill("m9").join(" ")), currentTurn: 0, lastDiscard: null, dealerSeat: dealer, doorSeat: dealer, prevalentWind: 1,
    turnCount: 8, hasDrawn: true, isFirstRound: false, isAfterKong: false, stateVersion: 4,
    roomSettings: { totalRounds: 1, basePoints: 100, fanPoints: 20 },
    roundInfo: { currentRound: 1, currentGame: last ? 4 : 2, dealerConsecutive: 0, initialDealerSeat: 0 },
    playerScores: [300, -100, -100, -100], handsCompleted: last ? 3 : 1, startedAt: "2026-10-20T09:00:00.000Z",
  } as MahjongGameState;
  rooms[id] = { id, code: id, game_state: s, status: "playing" };
  rs.reset(); sent.length = 0;
  return s;
}
async function call(fn: (r: Request) => Promise<Response>, roomId: string, body: object) {
  const r = await fn(new Request("http://x", { method: "POST", headers: asSeat({ roomId, ...body }), body: JSON.stringify({ roomId, ...body }) }));
  return { status: r.status, body: await r.json() };
}
const st = (id: string) => rooms[id]?.game_state as MahjongGameState | undefined;
const results: string[] = [];
function eq(a: unknown, e: unknown, msg: string) {
  const ok = JSON.stringify(a) === JSON.stringify(e);
  results.push(`${ok ? "✅" : "❌"} ${msg}\n   預期=${JSON.stringify(e)} 實際=${JSON.stringify(a)}`);
}
/** seat 拿到 7 條後打出，回傳打牌結果 */
async function discardS7(id: string, seat: number) {
  const s = st(id)!;
  const tile = t("s7"); s.players[seat].hand.push(tile);
  s.currentTurn = seat; s.hasDrawn = true; s.drawnTileId = tile.id; s.lastDiscard = null; s.pendingActions = undefined;
  return call(discard, id, { playerId: `p${seat}`, tileId: tile.id });
}
/** 整場還沒結束：狀態 finished（等下一局）、gameOver=false、沒寫紀錄、房間還在 */
const continuing = (id: string) => [st(id)?.status, st(id)?.gameOver, rs.records.length, !!rooms[id], st(id)?.handsCompleted];
const allNext = async (id: string) => { for (let i = 0; i < 4; i++) await call(nextGame, id, { playerId: `p${i}` }); };

// ---- ① 最後一局莊家自摸 → 連莊，繼續打；之後閒家胡才結束 ----
{
  const s = room("A");
  s.players[DEALER].hand = tiles(H16);
  s.currentTurn = DEALER; s.hasDrawn = false; s.wall[0] = t("s7");
  await call(draw, "A", { playerId: `p${DEALER}` });
  const w = await call(action, "A", { playerId: `p${DEALER}`, actionType: "win" });
  const afterFirst = [...(st("A")?.playerScores ?? [])];
  eq([w.status, ...continuing("A")], [200, "finished", false, 0, true, 4], "L1 最後一局莊家自摸：整場沒結束（不寫紀錄、不刪房），打完的局數 3→4");
  await allNext("A");
  const n = st("A");
  if (!n) {
    // 沒有連莊、房間已被刪（修正前的行為）：L2、L3 都算失敗，繼續跑其他情境
    eq("房間已刪", "繼續打", "L2 四家按下一局：同一個莊家連 1，還是第 4 局，分數延續");
    eq("沒有連莊的那一局", "閒家胡後結束", "L3 連莊後閒家胡：整場結束，紀錄是 completed、打完 5 局，總分＝最後累計，房間刪除");
  } else {
    eq([n.status, n.dealerSeat, n.roundInfo?.currentGame, n.roundInfo?.dealerConsecutive, n.handsCompleted, n.playerScores], ["playing", DEALER, 4, 1, 4, afterFirst],
      "L2 四家按下一局：同一個莊家連 1，還是第 4 局，分數延續");
    // 連莊這局換閒家胡 → 莊家下莊、整場結束
    n.players.forEach((p) => (p.hand = tiles(NOT_WAIT)));
    n.players[1].hand = tiles(H16);
    sent.length = 0;
    await discardS7("A", 0);
    const w2 = await call(action, "A", { playerId: "p1", actionType: "win" });
    const over = sent.find((e) => e.event === "mj_game_over")?.payload as { gameOver: boolean; playerScores: number[] } | undefined;
    const rec = rs.records[0];
    eq([w2.status, over?.gameOver, rec?.endReason, rec?.handsPlayed, rec?.players.map((p) => p.totalScore), rooms.A ?? null],
      [200, true, "completed", 5, over?.playerScores, null], "L3 連莊後閒家胡：整場結束，紀錄是 completed、打完 5 局，總分＝最後累計，房間刪除");
  }
}
// ---- ② 最後一局莊家胡別人放的槍 ----
{
  const s = room("B");
  s.players[DEALER].hand = tiles(H16);
  await discardS7("B", 0);
  const w = await call(action, "B", { playerId: `p${DEALER}`, actionType: "win" });
  eq([w.status, ...continuing("B")], [200, "finished", false, 0, true, 4], "L4 最後一局莊家放槍胡：連莊，整場沒結束");
}
// ---- ③ 最後一局流局 ----
{
  const s = room("C");
  s.currentTurn = 1; s.hasDrawn = false; s.wall = s.wall.slice(0, 16);
  const d = await call(draw, "C", { playerId: "p1" });
  eq([d.status, d.body.draw, ...continuing("C")], [200, true, "finished", false, 0, true, 4], "L5 最後一局流局：連莊，整場沒結束");
  await allNext("C");
  eq([st("C")?.status, st("C")?.dealerSeat, st("C")?.roundInfo?.dealerConsecutive], ["playing", DEALER, 1], "L6 流局後按下一局：同一個莊家連 1 繼續打");
}
// ---- ④ 最後一局一砲三響，裡面有莊家 ----
{
  const s = room("D");
  for (const seat of [1, 2, DEALER]) s.players[seat].hand = tiles(H16);
  await discardS7("D", 0);
  const ws = [];
  for (const seat of [1, 2, DEALER]) ws.push((await call(action, "D", { playerId: `p${seat}`, actionType: "win" })).status);
  eq([ws, st("D")?.winners?.map((w) => w.seat).sort(), ...continuing("D")], [[200, 200, 200], [1, 2, 3], "finished", false, 0, true, 4],
    "L7 最後一局一砲三響（含莊家）：三家都算胡，莊家有胡所以連莊，整場沒結束");
}
// ---- ⑤ 最後一局閒家胡 → 照常結束 ----
{
  const s = room("E");
  s.players[1].hand = tiles(H16);
  await discardS7("E", 0);
  const w = await call(action, "E", { playerId: "p1", actionType: "win" });
  const over = sent.find((e) => e.event === "mj_game_over")?.payload as { gameOver: boolean; playerScores: number[] } | undefined;
  eq([w.status, over?.gameOver, rs.records[0]?.endReason, rs.records[0]?.handsPlayed, rs.records[0]?.players.map((p) => p.totalScore), rooms.E ?? null],
    [200, true, "completed", 4, over?.playerScores, null], "L8 最後一局閒家胡：照常整場結束，紀錄 completed、打完 4 局，房間刪除");
  const again = await call(nextGame, "E", { playerId: "p0" });
  eq(again.status >= 400, true, "L9 整場結束後不能再按下一局");
}
// ---- ⑥ 回歸：不是最後一局 ----
{
  const s = room("F", false, 1); // 第 2 局，莊家 seat1
  s.players[2].hand = tiles(H16);
  await discardS7("F", 0);
  await call(action, "F", { playerId: "p2", actionType: "win" });
  eq([...continuing("F")], ["finished", false, 0, true, 2], "L10 不是最後一局、閒家胡：整場沒結束");
  await allNext("F");
  eq([st("F")?.dealerSeat, st("F")?.roundInfo?.currentGame, st("F")?.roundInfo?.dealerConsecutive], [2, 3, 0], "L11 按下一局：莊家下莊換下家，進第 3 局");
}
{
  const s = room("G", false, 1);
  s.players[1].hand = tiles(H16);
  await discardS7("G", 0);
  await call(action, "G", { playerId: "p1", actionType: "win" });
  await allNext("G");
  eq([st("G")?.gameOver, st("G")?.dealerSeat, st("G")?.roundInfo?.currentGame, st("G")?.roundInfo?.dealerConsecutive], [false, 1, 2, 1],
    "L12 不是最後一局、莊家胡：照常連莊（連 1），局數不變");
}

console.log(results.join("\n"));
if (results.some((r) => r.startsWith("❌"))) process.exit(1);
