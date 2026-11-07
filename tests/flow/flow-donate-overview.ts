// 斗內次數顯示得更清楚（老闆 2026-11-08，接續〈斗內次數調查報告-2026-11-08〉的建議①②）
//   O1 對戰紀錄每位玩家的 settled：已結清 true、未結清 false、11/1 以前或老闆 null；
//       混合場次（同房一人結清、另一人未結清）不會互相影響——我自己的 myDue.settled 只看我自己的欠款
//   O2 玩家斗內總覽：一般玩家（自摸總數、11/1 後場次數、已結清／未結清場次數、還欠金額）
//   O3 老闆帳號：規則上不算斗內，settledMatches／unsettledMatches／due 固定 0，afterCutoffMatches 照實際數字回
//   O4 權限：一般玩家呼叫 403；帳號格式錯 400
import { GET as recordsGet } from "../../app/api/mahjong/records/route";
import { POST as settlePost } from "../../app/api/mahjong/admin/settlements/route";
import { GET as overviewGet } from "../../app/api/mahjong/admin/donate-overview/route";
import { tokens } from "../support/stub-auth";
import { addUser } from "../support/stub-donate-store";
import { records } from "../support/stub-records-store";
import { addMatch, clock, db, users } from "../support/stub-zimofx-store";

const results: string[] = [];
function eq(a: unknown, e: unknown, msg: string) {
  const ok = JSON.stringify(a) === JSON.stringify(e);
  results.push(`${ok ? "✅" : "❌"} ${msg}\n   預期=${JSON.stringify(e)} 實際=${JSON.stringify(a)}`);
}
const BOSS = "c5707922-f6f0-4c10-9c87-3532fdbf6b72";
const uid = (n: number) => `ec000000-0000-4000-8000-00000000000${n}`;
const rid = (n: number) => `ed000000-0000-4000-8000-00000000000${n}`;
const [A, B] = [1, 2].map(uid);
tokens.boss = { id: BOSS, displayName: "張育瑋", pictureUrl: null, isGuest: false };
tokens.a = { id: A, displayName: "阿明", pictureUrl: null, isGuest: false };
tokens.b = { id: B, displayName: "阿華", pictureUrl: null, isGuest: false };
users[BOSS] = { name: "張育瑋", avatarUrl: null };
users[A] = { name: "阿明", avatarUrl: null };
users[B] = { name: "阿華", avatarUrl: null };
for (const u of [BOSS, A, B]) await addUser(u);

const T = (s: string) => Date.parse(s + "+08:00");
const auth = (tok?: string): Record<string, string> => (tok ? { authorization: `Bearer ${tok}` } : {});
const call = async (fn: (r: Request) => Promise<Response>, url: string, body?: object, tok = "boss") => {
  const r = await fn(new Request("http://x" + url, body ? { method: "POST", headers: { "content-type": "application/json", ...auth(tok) }, body: JSON.stringify(body) } : { headers: auth(tok) }));
  return { status: r.status, body: await r.json() };
};
const get = async (fn: (r: Request) => Promise<Response>, url: string, tok?: string) => (await fn(new Request("http://x" + url, { headers: auth(tok) }))).json();
const d = await db();
let hn = 0;
const win = (room: string, u: string, at: string) => d.query("insert into mj_zimo_wins (room_id, hand_no, user_id, won_at) values ($1, $2, $3, $4)", [room, ++hn, u, new Date(T(at)).toISOString()]);
const hand = (room: string, seat: number) => d.query("insert into mj_hand_results (room_id, hand_no, winner_seat, from_seat, self_draw) values ($1, $2, $3, null, true)", [room, hn, seat]);
/** 一場：資料庫的 match_records（結清用）＋對戰紀錄 API 的紀錄；seats＝座位 0..3 的帳號（null＝沒人／遊客） */
async function match(room: string, code: string, start: string, end: string, seats: (string | null)[]) {
  await addMatch(room, code, T(start), T(end));
  records.push({ game: "mahjong", roomId: room, roomCode: code, startedAt: new Date(T(start)).toISOString(), endedAt: new Date(T(end)).toISOString(), endReason: "completed",
    totalRounds: 1, basePoints: 100, fanPoints: 20, settings: {}, handsPlayed: 4,
    players: seats.map((u, seat) => ({ seat, playerName: u ? (u === BOSS ? "張育瑋" : u === A ? "阿明" : "阿華") : "遊客", playerId: "p" + seat, userId: u, totalScore: 0 })) });
}
/** 自摸一次：記斗內紀錄＋每把結果（和真的自摸一樣兩邊都記），seat＝這個人在這場的座位 */
async function zimoAt(room: string, seat: number, u: string, at: string) {
  await win(room, u, at);
  await hand(room, seat);
}

// ---- 建場：R0（11/1 以前，A 自摸 1 次）、R1（A 2 次、B 1 次，混合場，只結清 A）、R2（A 1 次，不結清）、R3（老闆自摸 2 次）----
await match(rid(0), "9001", "2026-10-30T20:00:00", "2026-10-30T22:00:00", [A, B, null, null]);
await zimoAt(rid(0), 0, A, "2026-10-30T21:00:00");
await match(rid(1), "9002", "2026-11-02T18:00:00", "2026-11-02T20:00:00", [A, B, null, null]);
await zimoAt(rid(1), 0, A, "2026-11-02T18:30:00"); await zimoAt(rid(1), 0, A, "2026-11-02T19:00:00"); await zimoAt(rid(1), 1, B, "2026-11-02T19:10:00");
await match(rid(2), "9003", "2026-11-03T10:00:00", "2026-11-03T12:00:00", [A, B, null, null]);
await zimoAt(rid(2), 0, A, "2026-11-03T10:30:00");
await match(rid(3), "9004", "2026-11-04T10:00:00", "2026-11-04T12:00:00", [BOSS, null, null, null]);
await zimoAt(rid(3), 0, BOSS, "2026-11-04T10:30:00"); await zimoAt(rid(3), 0, BOSS, "2026-11-04T11:00:00");
clock.now = T("2026-11-04T13:00:00");
const settle1 = await call(settlePost, "/", { userId: A, roomIds: [rid(1)] });

// ---- O1 對戰紀錄 settled（含混合場不互相影響）----
const itemsA = (await get(recordsGet, "/?limit=10", "a")).items;
const itemsB = (await get(recordsGet, "/?limit=10", "b")).items;
// players 不帶 userId（伺服器刻意拿掉座位帳號，避免外流身分）：用座位挑人——seat0＝A、seat1＝B
const pOf = (items: { roomCode: string; players: { seat: number; settled?: boolean | null }[] }[], code: string, seat: number) =>
  items.find((x) => x.roomCode === code)!.players.find((p) => p.seat === seat)?.settled;
const myDueOf = (items: { roomCode: string; myDue: { zimo: number; due: number; settled: boolean } | null }[], code: string) => items.find((x) => x.roomCode === code)!.myDue;
eq([settle1.status, pOf(itemsA, "9001", 0), pOf(itemsA, "9002", 0), pOf(itemsA, "9002", 1), pOf(itemsA, "9003", 0), myDueOf(itemsA, "9002"), myDueOf(itemsA, "9003")],
  [200, null, true, false, false, { zimo: 2, due: 20, settled: true }, { zimo: 1, due: 10, settled: false }],
  "O1 混合場 9002（A 結清、B 未結清）：A（座位 0）的 settled true、B（座位 1）的 settled false（不互相影響）；9001 在 11/1 以前 null；9003 A 未結清 false；myDue.settled 只看我自己的欠款，不被同場其他人拖累");
eq(pOf(itemsB, "9002", 1), false, "O1 B 自己看這場，自己（座位 1）的 settled 一樣是 false（B 這場還沒結清）");

// ---- O2／O4 一般玩家呼叫總覽 403、帳號格式錯 400 ----
const deny = await call(overviewGet, `/?userId=${A}`, undefined, "a");
const badId = await call(overviewGet, "/?userId=not-a-uuid");
eq([deny.status, badId.status], [403, 400], "O4 一般玩家查總覽 403；帳號不是 uuid 格式 400");

// ---- O2 一般玩家總覽：A 自摸總數 4（R0 1＋R1 2＋R2 1）；11/1 後打過 2 場（R1、R2）、R1 已結清、R2 未結清、還欠 R2 的 NT$10 ----
const ov = await call(overviewGet, `/?userId=${A}`);
eq([ov.status, ov.body], [200, { totalHands: 4, afterCutoffMatches: 2, settledMatches: 1, unsettledMatches: 1, due: 10, isOwner: false }],
  "O2 阿明總覽：自摸總數 4（R0 1＋R1 2＋R2 1）；11/1 後打過 2 場（R1、R2）、已結清 1（R1）、未結清 1（R2）、還欠 NT$10");

// ---- O3 老闆帳號：規則上不算斗內 ----
const ovBoss = await call(overviewGet, `/?userId=${BOSS}`);
eq([ovBoss.status, ovBoss.body], [200, { totalHands: 2, afterCutoffMatches: 1, settledMatches: 0, unsettledMatches: 0, due: 0, isOwner: true }],
  "O3 老闆帳號：自摸總數照實際紀錄回（2）、afterCutoffMatches 照實際打過的場次數回（1）；settledMatches／unsettledMatches／due 規則上固定 0（老闆帳號不算斗內）");

console.log(results.join("\n"));
if (results.some((r) => r.startsWith("❌"))) process.exit(1);
