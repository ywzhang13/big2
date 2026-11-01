// 斗內與對戰紀錄的三個增量修改（老闆 2026-11-02；20261105_mahjong_hand_results.sql）
//   H1 真的自摸（action win）：記一列 winner=自摸座位、from=null、self_draw
//   H2 真的放槍胡（discard → action win）：記 winner=胡的座位、from=放槍座位
//   H3 流局：記一列 winner=-1（這把也算有紀錄）
//   H4 遊客胡牌：用座位記，遊客也記到（自摸紀錄 mj_zimo_wins 照舊不記遊客）
//   H5 同一把重複存檔不會多記；記錄失敗不影響存檔
//   H6 對戰紀錄：每一把都有紀錄的場次回每人胡牌（含自摸）、自摸、放槍數；不齊的場次和舊場次胡牌／放槍回 null、自摸照舊從自摸紀錄算
//   H8 一炮三響：三家各記一列、各算胡 1；放槍的人那一把只算放槍 1 次
//   H7 老闆帳號不算斗內：不產生應給、不在後台未結清、斗內卡 0、不能結清、對戰紀錄 myDue null；自摸紀錄保留；其他人不變
import { POST as discard } from "../../app/api/mahjong/discard/route";
import { POST as action } from "../../app/api/mahjong/action/route";
import { GET as donateGet } from "../../app/api/mahjong/donate/route";
import { GET as recordsGet } from "../../app/api/mahjong/records/route";
import { GET as settleGet, POST as settlePost } from "../../app/api/mahjong/admin/settlements/route";
import { recordZimoWins } from "../../lib/mahjong/donate/record";
import { rooms, hooks, saveGameState } from "../support/stub-db";
import { tokens } from "../support/stub-auth";
import { addUser, clock, handFail } from "../support/stub-donate-store";
import { addMatch, db, users } from "../support/stub-zimofx-store";
import { records } from "../support/stub-records-store";
import type { MahjongGameState, Meld } from "../../lib/mahjong/gameState";
import type { Tile, TileSuit } from "../../lib/mahjong/tiles";

hooks.onSaved = recordZimoWins; // 和真的 db.ts 一樣：存檔成功後記自摸和每把結果

const results: string[] = [];
function eq(a: unknown, e: unknown, msg: string) {
  const ok = JSON.stringify(a) === JSON.stringify(e);
  results.push(`${ok ? "✅" : "❌"} ${msg}\n   預期=${JSON.stringify(e)} 實際=${JSON.stringify(a)}`);
}
const BOSS = "c5707922-f6f0-4c10-9c87-3532fdbf6b72";
const U = ["a", "b", "c", "d"].map((x) => `${x.repeat(8)}-0000-4000-8000-00000000000e`);
const G = "99999999-0000-4000-8000-00000000000e"; // 遊客
["A", "B", "C", "D"].forEach((n, i) => { tokens[`line${n}`] = { id: U[i], displayName: n, pictureUrl: null, isGuest: false }; users[U[i]] = { name: n, avatarUrl: null }; });
tokens.guest = { id: G, displayName: "遊客", pictureUrl: null, isGuest: true };
tokens.boss = { id: BOSS, displayName: "張育瑋", pictureUrl: null, isGuest: false };
users[BOSS] = { name: "張育瑋", avatarUrl: null };
for (const u of U) await addUser(u);
await addUser(G, true);
await addUser(BOSS);
const d = await db();
const T = (s: string) => Date.parse(s + "+08:00");
clock.now = T("2026-11-03T20:00:00");

let nextId = 90000;
const t = (k: string): Tile => ({ id: nextId++, suit: k[0] as TileSuit, rank: parseInt(k.slice(1), 10), display: k });
const tiles = (s: string) => s.split(" ").filter(Boolean).map(t);
const H16 = "m1 m2 m3 m4 m5 m6 p7 p8 p9 s2 s3 s4 z4 z4 s5 s6"; // 聽 1/4/7 條
const NOT_WAIT = "m1 m1 m3 m4 m6 m7 m8 m9 s1 s3 s5 s9 z1 z2 z3 z6";
let roomN = 0;
const rid = () => `ee000000-0000-4000-8000-${String(++roomN).padStart(12, "0")}`;
/** 一間 2 圈的房（這局結束不會整場打完）；winner 這家聽 1/4/7 條；handsCompleted＝這把之前打完幾把 */
function mjRoom(userIds: (string | null)[], winner: number, selfDraw: boolean, handsCompleted = 0, id = rid()) {
  const s = {
    roomCode: String(6000 + roomN), status: "playing",
    players: [0, 1, 2, 3].map((seat) => ({ id: `p${seat}`, userId: userIds[seat], name: `玩家${seat + 1}`, seat, hand: tiles(NOT_WAIT), revealed: [] as Meld[], flowers: [] as Tile[], discards: [t("m9")], isDealer: seat === 0 })),
    wall: tiles(Array(40).fill("m9").join(" ")), lastDiscard: null, dealerSeat: 0, doorSeat: 0, prevalentWind: 1,
    turnCount: 8, isFirstRound: false, isAfterKong: false, stateVersion: 4,
    roomSettings: { totalRounds: 2, basePoints: 100, fanPoints: 20 },
    roundInfo: { currentRound: 1, currentGame: 2, dealerConsecutive: 0, initialDealerSeat: 0 },
    playerScores: [0, 0, 0, 0], handsCompleted, startedAt: "2026-11-03T19:00:00.000Z",
  } as unknown as MahjongGameState;
  s.players[winner].hand = tiles(H16);
  const prev = (winner + 3) % 4;
  if (selfDraw) { const drawn = t("s7"); s.players[winner].hand.push(drawn); Object.assign(s, { currentTurn: winner, hasDrawn: true, drawnTileId: drawn.id }); }
  else { s.players[prev].hand.push(t("s7")); Object.assign(s, { currentTurn: prev, hasDrawn: true }); }
  rooms[id] = { id, code: s.roomCode, game_state: s, status: "playing" };
  return id;
}
const auth = (tok?: string): Record<string, string> => (tok ? { authorization: `Bearer ${tok}` } : {});
async function post(fn: (r: Request) => Promise<Response>, body: object, tok?: string) {
  const r = await fn(new Request("http://x", { method: "POST", headers: { "content-type": "application/json", ...auth(tok) }, body: JSON.stringify(body) }));
  return { status: r.status, body: await r.json() };
}
const get = async (fn: (r: Request) => Promise<Response>, url: string, tok?: string) => (await fn(new Request("http://x" + url, { headers: auth(tok) }))).json();
async function zimo(userIds: (string | null)[], winner: number, tok: string, handsCompleted = 0, id?: string) {
  const room = mjRoom(userIds, winner, true, handsCompleted, id);
  return { id: room, ...(await post(action, { roomId: room, playerId: `p${winner}`, actionType: "win" }, tok)) };
}
async function ron(userIds: (string | null)[], winner: number, tok: string, discarderTok: string, handsCompleted = 0, id?: string) {
  const room = mjRoom(userIds, winner, false, handsCompleted, id);
  const prev = (winner + 3) % 4;
  const s = rooms[room].game_state;
  const dd = await post(discard, { roomId: room, playerId: `p${prev}`, tileId: s.players[prev].hand.find((x) => x.display === "s7")!.id }, discarderTok);
  const w = await post(action, { roomId: room, playerId: `p${winner}`, actionType: "win" }, tok);
  return { id: room, d: dd, w };
}
/** 流局：直接做一個已結算、沒有人胡的狀態存檔（和牌局流局後存檔一樣會觸發記錄） */
async function draw(id: string, handNo: number) {
  rooms[id] ??= { id, code: "6999", game_state: {} as MahjongGameState, status: "playing" };
  const s = { ...rooms[id].game_state, status: "finished", settlement: { deltas: [0, 0, 0, 0] }, handsCompleted: handNo, winner: undefined, winners: [] } as unknown as MahjongGameState;
  await saveGameState(id, s);
}
const rows = async (room: string) => (await d.query<{ hand_no: number; winner_seat: number; from_seat: number | null; self_draw: boolean }>("select hand_no, winner_seat, from_seat, self_draw from mj_hand_results where room_id = $1 order by hand_no, winner_seat", [room])).rows.map((r) => [r.hand_no, r.winner_seat, r.from_seat, r.self_draw]);

// ---- H1 自摸 ----
const z1 = await zimo([U[1], U[0], U[2], U[3]], 1, "lineA");
eq([z1.status, await rows(z1.id)], [200, [[1, 1, null, true]]], "H1 A（座位 1）真的自摸：記一列 第 1 把、胡牌座位 1、沒有放槍、自摸");

// ---- H2 放槍胡 ----
const r1 = await ron([U[0], U[3], U[1], U[2]], 2, "lineB", "lineD");
eq([r1.d.status, r1.w.status, await rows(r1.id)], [200, 200, [[1, 2, 1, false]]], "H2 B（座位 2）胡 D（座位 1）打的牌：記胡牌座位 2、放槍座位 1、不是自摸");

// ---- H3 流局 ----
const dr = rid();
await draw(dr, 1);
eq(await rows(dr), [[1, -1, null, false]], "H3 流局：記一列胡牌座位 -1、沒有放槍（這把照樣算有紀錄）");

// ---- H4 遊客胡牌 ----
const g1 = await ron([U[0], U[1], U[2], G], 3, "guest", "lineC");
const gz = await zimo([G, U[1], U[2], U[3]], 0, "guest");
const guestZimo = await d.query("select 1 from mj_zimo_wins where user_id = $1", [G]);
eq([g1.w.status, await rows(g1.id), gz.status, await rows(gz.id), guestZimo.rows.length], [200, [[1, 3, 2, false]], 200, [[1, 0, null, true]], 0],
  "H4 遊客（座位 3）胡 C 放槍、遊客（座位 0）自摸：每把結果都用座位記到；自摸紀錄照舊不記遊客");

// ---- H5 重複存檔、記錄失敗 ----
await saveGameState(z1.id, rooms[z1.id].game_state);
await recordZimoWins(z1.id, rooms[z1.id].game_state);
handFail.on = true;
const z2 = await zimo([U[1], U[0], U[2], U[3]], 1, "lineA");
handFail.on = false;
eq([await rows(z1.id), z2.status, rooms[z2.id].game_state.status, await rows(z2.id)], [[[1, 1, null, true]], 200, "finished", []],
  "H5 同一把再存兩次、重記一次：還是 1 列；記錄失敗時牌局照樣存檔結算（只是沒記到這把）");

// ---- H6 對戰紀錄 ----
// 新場次 NEW：3 把（A 自摸、遊客胡 C 放槍、流局），每一把都有紀錄；PART：打了 2 把但只記到 1 把（上線時正在打）；OLD：都沒有紀錄
const NEW = rid(), PART = rid(), OLD = rid();
await zimo([U[0], U[1], U[2], G], 0, "lineA", 0, NEW);
const nr = await ron([U[0], U[1], U[2], G], 3, "guest", "lineC", 1, NEW); // 遊客（座位 3）胡 C（座位 2）打的牌
await draw(NEW, 3);
await zimo([U[0], U[1], U[2], G], 0, "lineA", 1, PART); // 第 2 把
await d.query("insert into mj_zimo_wins (room_id, hand_no, user_id, won_at) values ($1, 1, $2, $3)", [PART, U[0], new Date(T("2026-11-03T19:10:00")).toISOString()]); // 上線前那把（只有自摸紀錄）
await d.query("insert into mj_zimo_wins (room_id, hand_no, user_id, won_at) values ($1, 1, $2, $3)", [OLD, U[1], new Date(T("2026-10-20T20:00:00")).toISOString()]);
const rec = (id: string, code: string, hands: number, end: string) => records.push({ game: "mahjong", roomId: id, roomCode: code, startedAt: null, endedAt: new Date(T(end)).toISOString(), endReason: "completed",
  totalRounds: 1, basePoints: 100, fanPoints: 20, settings: {}, handsPlayed: hands,
  players: [[U[0], "A"], [U[1], "B"], [U[2], "C"], [null, "遊客"]].map(([u, name], seat) => ({ seat, playerName: name as string, playerId: "p" + seat, userId: u, totalScore: 0 })) });
rec(NEW, "7001", 3, "2026-11-03T21:00:00"); rec(PART, "7002", 2, "2026-11-03T21:10:00"); rec(OLD, "7003", 5, "2026-10-20T22:00:00");
const items = (await get(recordsGet, "/?limit=10", "lineA")).items;
const ps = (code: string) => items.find((x: { roomCode: string }) => x.roomCode === code).players.map((p: { seat: number; wins: number | null; selfDraws: number | null; dealIns: number | null }) => [p.seat, p.wins, p.selfDraws, p.dealIns]);
eq([nr.w.status, await rows(NEW), ps("7001"), ps("7002"), ps("7003")],
  [200, [[1, 0, null, true], [2, 3, 2, false], [3, -1, null, false]],
   [[0, 1, 1, 0], [1, 0, 0, 0], [2, 0, 0, 1], [3, 1, 0, 0]],
   [[0, null, 2, null], [1, null, 0, null], [2, null, 0, null], [3, null, 0, null]],
   [[0, null, 0, null], [1, null, 1, null], [2, null, 0, null], [3, null, 0, null]]],
  "H6 對戰紀錄：每一把都有紀錄的場次 → A 胡 1（自摸 1）、C 放槍 1、遊客胡 1；只記到一部分的場次和舊場次 → 胡牌、放槍回 null，自摸照舊從自摸紀錄算（遊客 0）");

// ---- H7 老闆帳號不算斗內 ----
const OWN = rid();
await addMatch(OWN, "8001", T("2026-11-03T10:00:00"), T("2026-11-03T12:00:00"));
await d.query("insert into mj_zimo_wins (room_id, hand_no, user_id, won_at) values ($1, 1, $2, $3), ($1, 2, $2, $4), ($1, 3, $5, $4)",
  [OWN, BOSS, new Date(T("2026-11-03T10:30:00")).toISOString(), new Date(T("2026-11-03T11:00:00")).toISOString(), U[2]]);
records.push({ game: "mahjong", roomId: OWN, roomCode: "8001", startedAt: null, endedAt: new Date(T("2026-11-03T12:00:00")).toISOString(), endReason: "completed",
  totalRounds: 1, basePoints: 100, fanPoints: 20, settings: {}, handsPlayed: 3,
  players: [[BOSS, "張育瑋"], [U[2], "C"], [U[3], "D"], [null, "遊客"]].map(([u, name], seat) => ({ seat, playerName: name as string, playerId: "p" + seat, userId: u, totalScore: 0 })) });
const bossCard = await get(donateGet, "/", "boss");
const list = await get(settleGet, "/", "boss");
const bossSettle = await post(settlePost, { userId: BOSS, roomIds: [OWN] }, "boss");
const bossRec = (await get(recordsGet, "/?limit=10", "boss")).items.find((x: { roomCode: string }) => x.roomCode === "8001");
const kept = await d.query("select 1 from mj_zimo_wins where user_id = $1", [BOSS]);
const cRow = list.players.find((p: { userId: string }) => p.userId === U[2]);
eq([bossCard, list.players.some((p: { userId: string }) => p.userId === BOSS), [bossSettle.status, bossSettle.body.error], bossRec.myDue, bossRec.players[0].selfDraws, kept.rows.length, [cRow?.matches, cRow?.zimo, cRow?.amount]],
  [{ count: 0, show: false }, false, [409, "nothing_due"], null, 2, 2, [1, 1, 10]],
  "H7 老闆自摸 2 次：斗內卡 0、後台未結清沒有他、結清他 409 nothing_due、對戰紀錄 myDue null（自摸數照樣顯示 2）、自摸紀錄還在；同場 C 自摸 1 次照樣欠 NT$10");

// ---- H8 一炮三響 ----
const TRIPLE = rid();
rooms[TRIPLE] = { id: TRIPLE, code: "8101", game_state: {} as MahjongGameState, status: "playing" };
await saveGameState(TRIPLE, { status: "finished", settlement: { deltas: [0, 0, 0, 0] }, handsCompleted: 1, players: [0, 1, 2, 3].map((seat) => ({ seat, userId: null })),
  winners: [{ seat: 1, from: 0, score: 1 }, { seat: 2, from: 0, score: 1 }, { seat: 3, from: 0, score: 1 }] } as unknown as MahjongGameState);
records.push({ game: "mahjong", roomId: TRIPLE, roomCode: "8101", startedAt: null, endedAt: new Date(T("2026-11-03T23:00:00")).toISOString(), endReason: "completed",
  totalRounds: 1, basePoints: 100, fanPoints: 20, settings: {}, handsPlayed: 1,
  players: [[U[0], "A"], [U[1], "B"], [U[2], "C"], [null, "遊客"]].map(([u, name], seat) => ({ seat, playerName: name as string, playerId: "p" + seat, userId: u, totalScore: 0 })) });
const tri = (await get(recordsGet, "/?limit=20", "lineA")).items.find((x: { roomCode: string }) => x.roomCode === "8101");
eq([await rows(TRIPLE), tri.players.map((p: { seat: number; wins: number | null; selfDraws: number | null; dealIns: number | null }) => [p.seat, p.wins, p.selfDraws, p.dealIns])],
  [[[1, 1, 0, false], [1, 2, 0, false], [1, 3, 0, false]], [[0, 0, 0, 1], [1, 1, 0, 0], [2, 1, 0, 0], [3, 1, 0, 0]]],
  "H8 一炮三響（A 座位 0 放槍給三家）：記三列、三家各胡 1；A 這一把只算放槍 1 次（不是 3 次）");

console.log(results.join("\n"));
if (results.some((r) => r.startsWith("❌"))) process.exit(1);
