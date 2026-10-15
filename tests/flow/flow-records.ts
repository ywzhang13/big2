// 對局總結算紀錄＋自動清房：麻將（打完、解散、沒打完、上線前的房、重送、寫入失敗）與清理閒置房（麻將、大老二）
import { POST as discard } from "../../app/api/mahjong/discard/route";
import { POST as draw } from "../../app/api/mahjong/draw/route";
import { POST as action } from "../../app/api/mahjong/action/route";
import { POST as leaveRequest } from "../../app/api/mahjong/leave-request/route";
import { POST as leaveVote } from "../../app/api/mahjong/leave-vote/route";
import { GET as stateGet } from "../../app/api/mahjong/state/route";
import { rooms } from "../support/stub-db";
import { sent } from "../support/stub-broadcast";
import * as rs from "../support/stub-records-store";
import { closeMahjongRoom, endedResponse, sweepIdleRooms } from "../../lib/records/close";
import { big2RoundScores, calculateScore } from "../../lib/scoring";
import type { Card } from "../../lib/constants";
import type { MahjongGameState, Meld } from "../../lib/mahjong/gameState";
import type { Tile, TileSuit } from "../../lib/mahjong/tiles";
import { asSeat } from "../support/stub-auth";

let nextId = 70000;
const t = (k: string): Tile => ({ id: nextId++, suit: k[0] as TileSuit, rank: parseInt(k.slice(1), 10), display: k });
const tiles = (s: string) => s.split(" ").filter(Boolean).map(t);
const H16 = "m1 m2 m3 m4 m5 m6 p7 p8 p9 s2 s3 s4 z4 z4 s5 s6"; // 聽 1/4/7 條
const NOT_WAIT = "m1 m1 m3 m4 m6 m7 m8 m9 s1 s3 s5 s9 z1 z2 z3 z6";
const NOW = Date.parse("2026-10-20T12:00:00.000Z");
const ago = (h: number) => new Date(NOW - h * 3600_000).toISOString();

/** 1 圈的房，handsCompleted 局已打完；lastHand=true 時是第 4 局（打完就整場結束） */
function mjRoom(id: string, code: string, o: { handsCompleted?: number; lastHand?: boolean; scores?: number[]; status?: string } = {}) {
  const s = {
    roomCode: code, status: o.status ?? "playing",
    players: [0, 1, 2, 3].map((seat) => ({ id: `p${seat}`, name: `玩家${seat + 1}`, seat, hand: tiles(NOT_WAIT), revealed: [] as Meld[], flowers: [] as Tile[], discards: [t("m9")], isDealer: seat === 0 })),
    wall: tiles(Array(40).fill("m9").join(" ")), currentTurn: 3, lastDiscard: null, dealerSeat: 0, doorSeat: 0, prevalentWind: 1,
    turnCount: 8, hasDrawn: true, isFirstRound: false, isAfterKong: false, stateVersion: 4,
    roomSettings: { totalRounds: 1, basePoints: 100, fanPoints: 20 },
    roundInfo: { currentRound: 1, currentGame: o.lastHand ? 4 : 2, dealerConsecutive: 0, initialDealerSeat: 0 },
    playerScores: o.scores ?? [300, -100, -100, -100],
    ...(o.handsCompleted === undefined ? {} : { handsCompleted: o.handsCompleted, startedAt: "2026-10-20T09:00:00.000Z" }),
  } as MahjongGameState;
  s.players[1].hand = tiles(H16);
  s.players[3].hand.push(t("s7"));
  rooms[id] = { id, code, game_state: s, status: s.status };
  return s;
}
async function call(fn: (r: Request) => Promise<Response>, roomId: string, body: object) {
  const r = await fn(new Request("http://x", { method: "POST", headers: asSeat({ roomId, ...body }), body: JSON.stringify({ roomId, ...body }) }));
  return { status: r.status, body: await r.json() };
}
async function getState(roomId: string) {
  const r = await stateGet(new Request(`http://x/api/mahjong/state?roomId=${roomId}&playerId=p0`, { headers: asSeat({ playerId: "p0" }) }));
  return { status: r.status, body: await r.json() };
}
/** seat3 打出 7 條、seat1 胡 */
async function ronLastHand(roomId: string) {
  const s = rooms[roomId].game_state;
  await call(discard, roomId, { playerId: "p3", tileId: s.players[3].hand.find((x) => x.display === "s7")!.id });
  return call(action, roomId, { playerId: "p1", actionType: "win" });
}
const results: string[] = [];
function eq(a: unknown, e: unknown, msg: string) {
  const ok = JSON.stringify(a) === JSON.stringify(e);
  results.push(`${ok ? "✅" : "❌"} ${msg}\n   預期=${JSON.stringify(e)} 實際=${JSON.stringify(a)}`);
}
const brief = (r: (typeof rs.records)[number]) => ({ game: r.game, roomCode: r.roomCode, endReason: r.endReason, handsPlayed: r.handsPlayed, scores: r.players.map((p) => p.totalScore), names: r.players.map((p) => p.playerName), ids: r.players.map((p) => p.playerId) });

// --- ③ 麻將整場打完 ---
{
  rs.reset(); sent.length = 0;
  const st0 = JSON.parse(JSON.stringify(mjRoom("A", "1001", { handsCompleted: 3, lastHand: true }))) as MahjongGameState;
  const w = await ronLastHand("A");
  // seat1 胡 seat3：門清1（莊家不是贏家也不是放槍者）→ 100+20=120
  eq([w.status, rs.records.map(brief), rooms.A ?? null, rs.deleted],
    [200, [{ game: "mahjong", roomCode: "1001", endReason: "completed", handsPlayed: 4, scores: [300, 20, -100, -220], names: ["玩家1", "玩家2", "玩家3", "玩家4"], ids: ["p0", "p1", "p2", "p3"] }], null, [{ game: "mahjong", roomId: "A" }]],
    "M1 最後一局胡牌、整場打完：寫一筆 completed（總分＝最後累計、打完 4 局），寫完才刪房");
  const events = sent.map((e) => e.event);
  eq([events.indexOf("mj_game_over") < events.indexOf("mj_room_closed"), sent.find((e) => e.event === "mj_room_closed")?.payload],
    [true, { endReason: "completed", recorded: true, players: [{ seat: 0, playerName: "玩家1", totalScore: 300 }, { seat: 1, playerName: "玩家2", totalScore: 20 }, { seat: 2, playerName: "玩家3", totalScore: -100 }, { seat: 3, playerName: "玩家4", totalScore: -220 }] }],
    "M2 先送 mj_game_over（最終結算照常顯示），再送 mj_room_closed（不含玩家 id）");
  const st = await getState("A");
  eq([st.status, st.body.ended, st.body.error, st.body.record?.endReason, st.body.record?.players?.length, JSON.stringify(st.body).includes('"p1"')],
    [410, true, "這場已結束", "completed", 4, false], "M3 刪房後重新整理：state 回 410「這場已結束」＋總結算，不含玩家 id");
  // 重送：同一場再關一次（例如請求重試）
  const again = await closeMahjongRoom("A", "1001", { ...st0, status: "finished", gameOver: true } as MahjongGameState, "completed");
  eq([again, rs.records.length, rs.deleted.length], [false, 1, 1], "M4 同一場重送關房：回 already_closed，紀錄還是 1 筆、只刪一次");
}
// --- 流局打完最後一局（走 draw 路由）---
{
  rs.reset(); sent.length = 0;
  const s = mjRoom("B", "1002", { handsCompleted: 3, lastHand: true });
  s.currentTurn = 1; s.hasDrawn = false; s.wall = s.wall.slice(0, 16);
  const d = await call(draw, "B", { playerId: "p1" });
  const gB = rooms.B?.game_state;
  eq([d.status, rs.records.length, !!rooms.B, gB?.status, gB?.gameOver, gB?.handsCompleted],
    [200, 0, true, "finished", false, 4], "M5 最後一局流局：莊家連莊、整場還沒結束（不寫紀錄、不刪房），打完的局數照實加到 4");
}
// --- 寫入失敗：不刪房、遊戲不卡住，之後清理再補 ---
{
  rs.reset(); sent.length = 0;
  mjRoom("C", "1003", { handsCompleted: 3, lastHand: true });
  rs.opts.failClose = true;
  const w = await ronLastHand("C");
  const st = await getState("C");
  eq([w.status, rs.records.length, !!rooms.C, rooms.C?.game_state.status, rooms.C?.game_state.gameOver, sent.some((e) => e.event === "mj_room_closed"), st.status],
    [200, 0, true, "finished", true, false, 200], "M6 關房交易中途失敗：胡牌照常回 200、房間和紀錄都維持原狀（已結束狀態、0 筆紀錄）、不送 mj_room_closed、state 照常讀得到");
  rs.opts.failClose = false;
  rs.mjUpdatedAt.C = ago(13);
  const done = await sweepIdleRooms(NOW);
  eq([done.mahjong, rs.records.map((r) => r.endReason), rooms.C ?? null], [1, ["completed"], null], "M7 之後建房時清理：補寫成 completed（不是解散）並刪房");
}
// --- 四家同意中途解散 ---
async function dissolve(roomId: string) {
  await call(leaveRequest, roomId, { playerId: "p0" });
  for (const p of ["p1", "p2", "p3"]) await call(leaveVote, roomId, { playerId: p, approve: true });
}
{
  rs.reset(); sent.length = 0;
  mjRoom("D", "1004", { handsCompleted: 2, scores: [80, -40, 0, -40] });
  await dissolve("D");
  eq([rs.records.map(brief), rooms.D ?? null], [[{ game: "mahjong", roomCode: "1004", endReason: "dissolved", handsPlayed: 2, scores: [80, -40, 0, -40], names: ["玩家1", "玩家2", "玩家3", "玩家4"], ids: ["p0", "p1", "p2", "p3"] }], null],
    "M8 打過 2 局後四家同意解散：記 dissolved、總分是當下的累計，然後刪房");
}
{
  rs.reset(); sent.length = 0;
  mjRoom("E", "1005", { handsCompleted: 0, scores: [0, 0, 0, 0] });
  await dissolve("E");
  eq([rs.records.length, rooms.E ?? null, rs.deleted.length], [0, null, 1], "M9 一局都沒打完就解散：不記紀錄、直接刪房");
}
{
  rs.reset(); sent.length = 0;
  mjRoom("F", "1006", { lastHand: true }); // 上線前開局（沒有 handsCompleted）
  await ronLastHand("F");
  eq([rs.records.length, rooms.F ?? null], [0, null], "M10 上線前就開局的房間打完：不補記紀錄（照常刪房）");
}
{
  rs.reset(); sent.length = 0;
  mjRoom("G", "1007", { handsCompleted: 1 });
  rs.opts.failClose = true;
  await dissolve("G");
  eq([rs.records.length, !!rooms.G, rooms.G?.game_state.status], [0, true, "finished"], "M11 解散時交易中途失敗：房間保留、沒有紀錄（之後清理會再試）");
}

// --- ④ 建房時清理閒置房 ---
{
  rs.reset(); sent.length = 0;
  rooms.W1 = { id: "W1", code: "2001", status: "waiting", game_state: { roomSettings: { totalRounds: 1, basePoints: 100, fanPoints: 20 } } as unknown as MahjongGameState };
  rooms.W2 = { id: "W2", code: "2002", status: "waiting", game_state: null as unknown as MahjongGameState };
  rs.mjUpdatedAt.W1 = ago(3); rs.mjUpdatedAt.W2 = ago(1);
  mjRoom("P1", "2003", { handsCompleted: 2, scores: [60, -20, -20, -20] }); rs.mjUpdatedAt.P1 = ago(13);
  mjRoom("P2", "2004", { handsCompleted: 2 }); rs.mjUpdatedAt.P2 = ago(11);
  mjRoom("P3", "2005", { handsCompleted: 0 }); rs.mjUpdatedAt.P3 = ago(13);
  const done = await sweepIdleRooms(NOW);
  eq([done.mahjong, Object.keys(rooms).filter((k) => ["W1", "W2", "P1", "P2", "P3"].includes(k)).sort(), rs.records.map((r) => [r.roomCode, r.endReason, r.players.map((p) => p.totalScore)])],
    [3, ["P2", "W2"], [["2003", "dissolved", [60, -20, -20, -20]]]],
    "S1 麻將：等待中閒置 3 小時刪、1 小時留；進行中閒置 13 小時且打過牌 → 記 dissolved 再刪；11 小時留；沒打完一局的直接刪");
}
{
  rs.reset();
  const hand = (s: string) => s.split(" ").filter(Boolean);
  const players = (roomId: string, hands: string[][]) =>
    hands.map((h, seat) => ({ player_id: `${roomId}-p${seat}`, name: `大${seat + 1}`, seat, hand: h }));
  rs.big2Rooms.B1 = { room: { id: "B1", records_enabled: true, code: "3001", status: "playing", created_at: "2026-10-20T08:00:00.000Z", updated_at: ago(13), scores: { "B1-p0": 50, "B1-p1": -10, "B1-p2": -20, "B1-p3": -20 } }, players: players("B1", [hand("3C 4C"), hand("5C"), hand("6C"), hand("7C")]) };
  // 剛打完一局（status=finished）還沒按下一局：這局也要算進總分。seat0 出完，其他人各剩 1 張（-5）→ seat0 +15
  rs.big2Rooms.B2 = { room: { id: "B2", records_enabled: true, code: "3002", status: "finished", created_at: "2026-10-20T08:00:00.000Z", updated_at: ago(13), scores: {} }, players: players("B2", [[], hand("5C"), hand("6C"), hand("7C")]) };
  rs.big2Rooms.B3 = { room: { id: "B3", records_enabled: true, code: "3003", status: "waiting", created_at: "2026-10-20T08:00:00.000Z", updated_at: ago(3), scores: {} }, players: players("B3", [[]]) };
  rs.big2Rooms.B4 = { room: { id: "B4", records_enabled: false, code: "3004", status: "playing", created_at: "2026-10-15T08:00:00.000Z", updated_at: ago(13), scores: { "B4-p0": 30 } }, players: players("B4", [hand("3C"), hand("4C"), hand("5C"), hand("6C")]) };
  rs.big2Rooms.B5 = { room: { id: "B5", records_enabled: true, code: "3005", status: "playing", created_at: "2026-10-20T08:00:00.000Z", updated_at: ago(13), scores: {} }, players: players("B5", [hand("3C"), hand("4C"), hand("5C"), hand("6C")]) };
  rs.big2Rooms.B6 = { room: { id: "B6", records_enabled: true, code: "3006", status: "playing", created_at: "2026-10-20T08:00:00.000Z", updated_at: ago(11), scores: { "B6-p0": 5 } }, players: players("B6", [hand("3C"), hand("4C"), hand("5C"), hand("6C")]) };
  const done = await sweepIdleRooms(NOW);
  eq([done.big2, Object.keys(rs.big2Rooms).sort(), rs.records.map((r) => [r.game, r.roomCode, r.endReason, r.players.map((p) => p.totalScore)])],
    [5, ["B6"], [["big2", "3001", "dissolved", [50, -10, -20, -20]], ["big2", "3002", "dissolved", [15, -5, -5, -5]]]],
    "S2 大老二：閒置 13 小時打過牌 → 記 dissolved；剛打完那局也算進總分；等待中 3 小時直接刪；上線前（舊程式，records_enabled=false）建的房不補記；一局都沒打完的直接刪；11 小時留");
}
{
  rs.reset();
  rs.big2Rooms.B7 = { room: { id: "B7", records_enabled: true, code: "3007", status: "playing", created_at: "2026-10-20T08:00:00.000Z", updated_at: ago(13), scores: { x: 1 } }, players: [0, 1, 2, 3].map((seat) => ({ player_id: seat === 0 ? "x" : `y${seat}`, name: `大${seat}`, seat, hand: ["3C"] })) };
  rs.opts.failClose = true;
  await sweepIdleRooms(NOW);
  eq([rs.records.length, !!rs.big2Rooms.B7], [0, true], "S3 大老二清理時交易中途失敗：房間和紀錄都維持原狀");
  rs.opts.failClose = false;
  await sweepIdleRooms(NOW);
  await sweepIdleRooms(NOW);
  eq([rs.records.length, !!rs.big2Rooms.B7], [1, false], "S4 下次清理成功：補寫 1 筆並刪房；再清一次也不會重複");
}

// --- 用房號查「這場已結束」（join 路由用）、以及大老二算分抽出來後結果不變 ---
{
  rs.reset();
  mjRoom("H", "1008", { handsCompleted: 3, lastHand: true });
  await ronLastHand("H");
  const byCode = await endedResponse("mahjong", { code: "1008" });
  const body = byCode ? await byCode.json() : null;
  rs.records[0].endedAt = new Date(Date.now() - 13 * 3600_000).toISOString(); // 13 小時前結束的舊紀錄
  const old = await endedResponse("mahjong", { code: "1008" });
  eq([byCode?.status, body?.record?.roomCode, old], [410, "1008", null], "J1 房號剛結束：join 會回 410「這場已結束」；超過 12 小時的舊紀錄不算（房號會被重用）");
}
{
  const hands: Card[][] = [[], ["3C", "2D"], ["4C", "5C", "6C", "7C", "8C", "9C", "TC"], ["2S", "2H", "3D"]];
  const players = hands.map((hand, i) => ({ player_id: `q${i}`, hand }));
  // 原本 continue 路由的寫法：沒出完的照手牌算，出完的人拿走其他三家負分總和
  const expected: Record<string, number> = {};
  let losers = 0; let winner = "";
  for (const p of players) { const sc = calculateScore(p.hand); expected[p.player_id] = sc; if (sc === 0) winner = p.player_id; else losers += sc; }
  expected[winner] = Math.abs(losers);
  eq(big2RoundScores(players), expected, "B1 大老二算分抽成 big2RoundScores 後，和原本 continue 路由的算法完全一樣（含 2 的加倍、7 張以上加倍）");
}

// --- 審伯退件回歸 ①：選中後、刪除前房間有新動作 → 不刪也不記 ---
{
  rs.reset(); sent.length = 0;
  mjRoom("Q1", "4001", { handsCompleted: 2 }); rs.mjUpdatedAt.Q1 = ago(13);
  rs.big2Rooms.Q2 = { room: { id: "Q2", records_enabled: true, code: "4002", status: "playing", created_at: "2026-10-20T08:00:00.000Z", updated_at: ago(13), scores: { a: 5 } }, players: [0, 1, 2, 3].map((seat) => ({ player_id: seat ? `b${seat}` : "a", name: `大${seat}`, seat, hand: ["3C"] })) };
  // 清理選中這兩間之後，玩家剛好回來打了一張（資料庫的 trigger 會更新 updated_at、row_version +1）
  rs.opts.beforeClose = (game, roomId) => {
    if ((game === "mahjong" && roomId === "Q1") || (game === "big2" && roomId === "Q2")) rs.touch(game, roomId, new Date(NOW).toISOString());
  };
  const done = await sweepIdleRooms(NOW);
  eq([done, !!rooms.Q1, !!rs.big2Rooms.Q2, rs.records.length, sent.some((e) => e.event === "mj_room_closed" || e.event === "room_closed")],
    [{ mahjong: 0, big2: 0 }, true, true, 0, false], "R1 清理選中後、刪除前房間有新動作（麻將、大老二）：房間保留、沒有紀錄、沒有送關房通知");
}
{
  rs.reset();
  const s = mjRoom("Q3", "4003", { handsCompleted: 4, lastHand: true });
  const stale = { ...JSON.parse(JSON.stringify(s)), status: "finished", gameOver: true } as MahjongGameState;
  rooms.Q3.game_state.stateVersion = (s.stateVersion ?? 0) + 1; // 存檔後又有人寫入（版本號變了）
  const r = await closeMahjongRoom("Q3", "4003", stale, "completed");
  eq([r, !!rooms.Q3, rs.records.length], [false, true, 0], "R2 打完／解散關房時版本號已經變了：不關房、不記紀錄");
}
// --- 審伯退件回歸 ②：同時送出關房，只有一筆紀錄、只刪一次；中途失敗兩邊都不變 ---
{
  let bad: unknown = null;
  for (let i = 0; i < 30; i++) {
    rs.reset();
    const s = mjRoom("Q4", "4004", { handsCompleted: 4, lastHand: true });
    const fin = { ...JSON.parse(JSON.stringify(s)), status: "finished", gameOver: true } as MahjongGameState;
    const r3 = await Promise.all([1, 2, 3].map(() => closeMahjongRoom("Q4", "4004", fin, "completed")));
    const now = { records: rs.records.length, deletes: rs.deleted.length, closedTrue: r3.filter(Boolean).length };
    if (now.records !== 1 || now.deletes !== 1 || now.closedTrue !== 1) bad = now;
  }
  eq(bad, null, "R3 同一間房同時送 3 次關房（30 回合）：每回合都只有 1 筆紀錄、只刪 1 次、只有 1 個回報成功");
}
{
  rs.reset();
  const s = mjRoom("Q5", "4005", { handsCompleted: 2 });
  rs.opts.failClose = true;
  const r = await closeMahjongRoom("Q5", "4005", s, "dissolved");
  eq([r, !!rooms.Q5, rs.records.length, rs.deleted.length], [false, true, 0, 0], "R4 關房交易中途失敗：房間還在、紀錄 0 筆（不會出現「有紀錄但房間沒刪」或「房間刪了但沒紀錄」）");
}
// --- 審伯退件回歸 ③：大老二「上線前不補記」看的是新版程式建房時寫的 records_enabled ---
{
  rs.reset();
  const mk = (id: string, enabled: boolean | undefined, created: string) => ({
    room: { id, code: id, ...(enabled === undefined ? {} : { records_enabled: enabled }), status: "playing", created_at: created, updated_at: ago(13), scores: { [`${id}-p0`]: 10 } },
    players: [0, 1, 2, 3].map((seat) => ({ player_id: `${id}-p${seat}`, name: `大${seat}`, seat, hand: ["3C"] })),
  });
  rs.big2Rooms.N1 = mk("N1", true, "2026-01-01T00:00:00.000Z"); // 新版程式建的（建房時間多早都算）
  rs.big2Rooms.N2 = mk("N2", false, "2026-12-31T00:00:00.000Z"); // 舊程式建的（就算時間很新也不算）
  rs.big2Rooms.N3 = mk("N3", undefined, "2026-12-31T00:00:00.000Z"); // migration 前的資料沒有這個欄位
  await sweepIdleRooms(NOW);
  eq([rs.records.map((r) => r.roomCode), Object.keys(rs.big2Rooms)], [["N1"], []],
    "R5 大老二：只看 records_enabled（新版程式建房時寫入），和建房時間、migration 時間無關；舊房照樣刪但不記");
}

console.log(results.join("\n"));
if (results.some((r) => r.startsWith("❌"))) process.exit(1);
