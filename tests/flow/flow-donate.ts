// 斗內給阿瑋：自摸次數（GET /api/mahjong/donate）與歸零（POST /api/mahjong/donate/ack），2026-10-21
//   D1 沒登入、訪客、還沒自摸的 LINE 帳號都是 0
//   D2 真的自摸（action win，自己摸牌）→ 只有自摸的人 +1
//   D3 放槍胡：胡的人、放槍的人都不算
//   D4 同一個結算狀態重複存檔、同一局重送 → 不會多算
//   D5 按斗內歸零；連按冪等、不會變負數
//   D6 歸零後再自摸從 1 開始；D7 每個人各自獨立
//   D8 訪客：自摸不寫入資料庫（伺服器分不出時由資料庫以 auth.users 排除）、按斗內不寫入；沒登入按斗內 401
//   D10 帳號刪除：自摸紀錄和歸零點跟著刪（外鍵 on delete cascade）
//   D9 自摸的判斷和整場統計一致（八仙過海算自摸、七搶一不算）；上線前的舊局、沒綁帳號的座位不記
import { POST as discard } from "../../app/api/mahjong/discard/route";
import { POST as action } from "../../app/api/mahjong/action/route";
import { GET as donateGet } from "../../app/api/mahjong/donate/route";
import { POST as donateAck } from "../../app/api/mahjong/donate/ack/route";
import { recordZimoWins, zimoUserIds } from "../../lib/mahjong/donate/record";
import { rooms, hooks, saveGameState } from "../support/stub-db";
import { tokens } from "../support/stub-auth";
import { addUser, clock, db } from "../support/stub-donate-store";
import type { MahjongGameState, Meld } from "../../lib/mahjong/gameState";
import type { Tile, TileSuit } from "../../lib/mahjong/tiles";

hooks.onSaved = recordZimoWins; // 和真的 db.ts 一樣：存檔成功後記自摸

const results: string[] = [];
function eq(a: unknown, e: unknown, msg: string) {
  const ok = JSON.stringify(a) === JSON.stringify(e);
  results.push(`${ok ? "✅" : "❌"} ${msg}\n   預期=${JSON.stringify(e)} 實際=${JSON.stringify(a)}`);
}

// 4 個 LINE 帳號＋1 個訪客
const U = ["a", "b", "c", "d", "e"].map((x) => `${x.repeat(8)}-0000-4000-8000-000000000000`);
["A", "B", "C", "D"].forEach((n, i) => (tokens[`line${n}`] = { id: U[i], displayName: n, pictureUrl: null, isGuest: false }));
tokens.guest = { id: U[4], displayName: "訪客", pictureUrl: null, isGuest: true };
const TOK = ["lineA", "lineB", "lineC", "lineD"];
for (const [i, u] of U.entries()) await addUser(u, i === 4); // 和正式庫一樣，帳號在 auth.users；U[4] 是遊客

let nextId = 90000;
const t = (k: string): Tile => ({ id: nextId++, suit: k[0] as TileSuit, rank: parseInt(k.slice(1), 10), display: k });
const tiles = (s: string) => s.split(" ").filter(Boolean).map(t);
const H16 = "m1 m2 m3 m4 m5 m6 p7 p8 p9 s2 s3 s4 z4 z4 s5 s6"; // 聽 1/4/7 條
const NOT_WAIT = "m1 m1 m3 m4 m6 m7 m8 m9 s1 s3 s5 s9 z1 z2 z3 z6";
let roomN = 0;

/** 開一間 2 圈的房（不會因為這局結束整場打完），四個座位綁 userIds；winner 這家聽 1/4/7 條 */
function mjRoom(userIds: (string | null)[], winner: number, o: { selfDraw: boolean; handsCompleted?: number | null }) {
  const id = `00000000-0000-4000-8000-${String(++roomN).padStart(12, "0")}`;
  const s = {
    roomCode: String(5000 + roomN), status: "playing",
    players: [0, 1, 2, 3].map((seat) => ({ id: `p${seat}`, userId: userIds[seat], name: `玩家${seat + 1}`, seat, hand: tiles(NOT_WAIT), revealed: [] as Meld[], flowers: [] as Tile[], discards: [t("m9")], isDealer: seat === 0 })),
    wall: tiles(Array(40).fill("m9").join(" ")), lastDiscard: null, dealerSeat: 0, doorSeat: 0, prevalentWind: 1,
    turnCount: 8, isFirstRound: false, isAfterKong: false, stateVersion: 4,
    roomSettings: { totalRounds: 2, basePoints: 100, fanPoints: 20 },
    roundInfo: { currentRound: 1, currentGame: 2, dealerConsecutive: 0, initialDealerSeat: 0 },
    playerScores: [0, 0, 0, 0],
    ...(o.handsCompleted === null ? {} : { handsCompleted: o.handsCompleted ?? 0, startedAt: "2026-10-21T00:00:00.000Z" }),
  } as unknown as MahjongGameState;
  s.players[winner].hand = tiles(H16);
  const prev = (winner + 3) % 4;
  if (o.selfDraw) {
    const drawn = t("s7");
    s.players[winner].hand.push(drawn);
    Object.assign(s, { currentTurn: winner, hasDrawn: true, drawnTileId: drawn.id });
  } else {
    s.players[prev].hand.push(t("s7"));
    Object.assign(s, { currentTurn: prev, hasDrawn: true });
  }
  rooms[id] = { id, code: s.roomCode, game_state: s, status: "playing" };
  return id;
}
const auth = (tok?: string): Record<string, string> => (tok ? { authorization: `Bearer ${tok}` } : {});
async function post(fn: (r: Request) => Promise<Response>, body: object, tok?: string) {
  const r = await fn(new Request("http://x", { method: "POST", headers: auth(tok), body: JSON.stringify(body) }));
  return { status: r.status, body: await r.json() };
}
const count = async (tok?: string) => (await (await donateGet(new Request("http://x", { headers: auth(tok) }))).json()).count;
const counts = async () => Promise.all(TOK.map((x) => count(x)));
const ack = (tok?: string) => post(donateAck, {}, tok);
/** winner 這家自摸 */
async function zimo(userIds: (string | null)[], winner: number, tok: string, handsCompleted?: number | null) {
  const id = mjRoom(userIds, winner, { selfDraw: true, handsCompleted });
  const r = await post(action, { roomId: id, playerId: `p${winner}`, actionType: "win" }, tok);
  return { id, ...r };
}
/** winner 這家胡上家打的牌（放槍） */
async function ron(userIds: (string | null)[], winner: number, tok: string, discarderTok: string) {
  const id = mjRoom(userIds, winner, { selfDraw: false });
  const prev = (winner + 3) % 4;
  const s = rooms[id].game_state;
  const d = await post(discard, { roomId: id, playerId: `p${prev}`, tileId: s.players[prev].hand.find((x) => x.display === "s7")!.id }, discarderTok);
  const w = await post(action, { roomId: id, playerId: `p${winner}`, actionType: "win" }, tok);
  return { id, d, w };
}
const seats = [U[0], U[1], U[2], U[3]];

// D1
eq([await count(), await count("guest"), await counts()], [0, 0, [0, 0, 0, 0]], "D1 沒登入、訪客、還沒自摸的 LINE 帳號：都是 { count: 0 }（不回錯誤）");

// D2 A（座位 1）自摸
clock.now += 1000;
const z1 = await zimo([U[1], U[0], U[2], U[3]], 1, "lineA");
eq([z1.status, rooms[z1.id].game_state.status, rooms[z1.id].game_state.handsCompleted, await counts()], [200, "finished", 1, [1, 0, 0, 0]],
  "D2 A 真的自摸（action win）：這局結算存檔後 A 是 1，其他三人 0");

// D3 放槍胡：B（座位 2）胡 D（座位 1）打的牌
clock.now += 1000;
const r1 = await ron([U[0], U[3], U[1], U[2]], 2, "lineB", "lineD");
eq([r1.d.status, r1.w.status, rooms[r1.id].game_state.winners?.[0]?.from, await counts()], [200, 200, 1, [1, 0, 0, 0]],
  "D3 B 胡 D 放槍：胡的人、放槍的人都不加，A 還是 1");

// D4 重複存檔、重送
await saveGameState(z1.id, rooms[z1.id].game_state);
await saveGameState(z1.id, rooms[z1.id].game_state);
await recordZimoWins(z1.id, rooms[z1.id].game_state);
const again = await post(action, { roomId: z1.id, playerId: "p1", actionType: "win" }, "lineA");
eq([again.status === 200, await count("lineA")], [false, 1], "D4 同一局的結算狀態再存檔兩次、直接重記一次、重送胡牌：A 還是 1");

// D5 歸零、連按
clock.now += 1000;
const a1 = await ack("lineA"), a2 = await ack("lineA"), a3 = await ack("lineA");
eq([a1, a2, a3, await counts()], [{ status: 200, body: { count: 0 } }, { status: 200, body: { count: 0 } }, { status: 200, body: { count: 0 } }, [0, 0, 0, 0]],
  "D5 A 按斗內：回 { count: 0 }，連按三次都一樣，次數歸零、不會變負數");
const before = await (await db()).query("select * from mj_donate_acks");
clock.now -= 10000; // 時鐘倒退（例如較舊的請求晚到）也不會把歸零點往前移
await ack("lineA");
clock.now += 10000;
const after = await (await db()).query("select * from mj_donate_acks");
eq(JSON.stringify(after.rows) === JSON.stringify(before.rows), true, "D5' 較晚到、時間較早的歸零請求不會把歸零點往前移（舊的自摸不會跑回來）");

// D6 歸零後再自摸
clock.now += 1000;
await zimo([U[0], U[1], U[2], U[3]], 0, "lineA");
eq(await counts(), [1, 0, 0, 0], "D6 歸零後 A 再自摸：從 1 開始");

// D7 各自獨立
clock.now += 1000;
await zimo(seats, 2, "lineC");
clock.now += 1000;
await zimo(seats, 2, "lineC", 5); // 另一間房（第 6 局）
eq(await counts(), [1, 0, 2, 0], "D7 C 自摸兩次：C 是 2，A 還是 1，B、D 是 0");
await ack("lineC");
eq(await counts(), [1, 0, 0, 0], "D7' C 按斗內只歸零 C 自己，A 不受影響");

// D8 訪客、沒登入
clock.now += 1000;
const gz = await zimo([U[0], U[4], U[2], U[3]], 1, "guest");
const gAck = await ack("guest");
const acks = (await (await db()).query<{ user_id: string }>("select user_id from mj_donate_acks order by 1")).rows.map((r) => r.user_id);
const guestRows = (await (await db()).query<{ n: number }>("select count(*)::int n from mj_zimo_wins where user_id = $1", [U[4]])).rows[0].n;
eq([gz.status, rooms[gz.id].game_state.status, guestRows, await count("guest"), gAck, acks.includes(U[4]), (await ack()).status],
  [200, "finished", 0, 0, { status: 200, body: { count: 0 } }, false, 401],
  "D8 訪客真的自摸：資料庫完全沒有寫入訪客的紀錄、查次數是 0；按斗內回 { count: 0 } 不寫入；沒登入按斗內 401");

// D9 自摸的判斷（和整場統計共用 isSelfDrawWin）、舊局、沒綁帳號
const fin = (winners: object[], extra: object = {}) => ({
  status: "finished", settlement: {}, handsCompleted: 3, lastDiscard: { from: 2 },
  players: [0, 1, 2, 3].map((seat) => ({ userId: U[seat] })), winners, ...extra,
}) as unknown as MahjongGameState;
const flower = { fans: [{ name: "八仙過海", value: 8 }], totalFan: 8 };
const rob = { fans: [{ name: "七搶一", value: 8 }], totalFan: 8 };
const plain = { fans: [{ name: "門清", value: 1 }], totalFan: 1 };
eq([
  zimoUserIds(fin([{ seat: 1, score: plain, from: null }]))?.userIds,
  zimoUserIds(fin([{ seat: 1, score: flower, from: null }]))?.userIds,
  zimoUserIds(fin([{ seat: 3, score: rob, from: 0 }]))?.userIds,
  zimoUserIds(fin([{ seat: 0, score: plain, from: 2 }]))?.userIds,
  zimoUserIds(fin([{ seat: 1, score: plain, from: null }], { handsCompleted: undefined })),
  zimoUserIds(fin([{ seat: 1, score: plain, from: null }], { status: "playing" })),
  zimoUserIds(fin([{ seat: 1, score: plain, from: null }], { players: [{}, { userId: null }, {}, {}] }))?.userIds,
], [[U[1]], [U[1]], [], [], null, null, []],
  "D9 自摸、八仙過海算自摸；七搶一（2026-10-22 起只有 1 張花的人付）和放槍不算；上線前的舊局（沒有局數）、還沒結算、沒綁帳號的座位都不記");
clock.now += 1000;
const legacy = await zimo(seats, 3, "lineD", null);
eq([legacy.status, await count("lineD")], [200, 0], "D9' 上線前開局的舊房（沒有 handsCompleted）真的自摸：不記");

// D10 刪帳號：外鍵連帶刪掉這個帳號的自摸紀錄和歸零點，別人的不動
{
  const q = async (sql: string, args: unknown[]) => (await (await db()).query<{ n: number }>(sql, args)).rows[0].n;
  const before = [await q("select count(*)::int n from mj_zimo_wins where user_id = $1", [U[0]]), await q("select count(*)::int n from mj_donate_acks where user_id = $1", [U[0]])];
  await (await db()).query("delete from auth.users where id = $1", [U[0]]);
  const after = [await q("select count(*)::int n from mj_zimo_wins where user_id = $1", [U[0]]), await q("select count(*)::int n from mj_donate_acks where user_id = $1", [U[0]])];
  eq([before.every((n) => n > 0), after, await count("lineC")], [true, [0, 0], 0], "D10 刪掉 A 的帳號：A 的自摸紀錄和歸零點都跟著刪，C 不受影響");
}

console.log(results.join("\n"));
if (results.some((r) => r.startsWith("❌"))) process.exit(1);
process.exit(0);
