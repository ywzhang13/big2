// 房卡流程（老柯 2026-11-20）：走真的十三支、麻將、後台、玩家路由；十三支和房卡帳都是記憶體 PostgreSQL 跑真的 migration。
//   C1 十三支 8 局：三位玩家各扣 4 張（第 1、3、5、7 局），坐在第四家的老闆 0 張；每一筆流水帳的房號、第幾局都對；餘額扣成負數
//   C2 同一把重送 3 次、同時送 3 次：只扣 1 次
//   C3 麻將：開局每人扣 1 張（老闆不扣）；莊家胡 → 下一把連莊不扣；下莊那一把照扣
//   C4 扣卡失敗（資料庫錯誤）不擋開局：牌照發、路由照回 200
//   C5 大老二開局（真的 dealAndStart）：不扣卡，流水帳筆數不變
//   S1 被暫停的人：十三支、麻將開房都 403 suspended，加入新房都 403 suspended（附暫停時間）
//   S2 被暫停的人坐在等人中的房 → 房主開局 403 player_suspended，回被暫停的人的座位和名字
//   S3 打到一半才被暫停：重新加入自己原本的座位照常、下一局照常開、照常扣卡
//   S4 恢復之後照常開房
//   A1 後台：沒登入 401、一般玩家 403（6 支都是）；老闆照常用
//   A2 充值、回收（可以收到負數）：同一個操作編號重送只生效一次、回第一次的餘額；同一個編號拿去回收 409 op_conflict
//   A6 狀態沒變的暫停／恢復也記住操作編號（審伯初審必修一）：舊的請求重送不能推翻之後的新決定、不新增紀錄；
//      同一個編號換人、換動作、拿去充值都是 409 op_conflict，帳和狀態不變
//   A3 張數不是 1～100000 的整數、帳號不對 400；老闆帳號不能操作（owner_exempt）；遊客、不存在的帳號 unknown_player
//   A4 玩家名單：沒有老闆、沒有遊客，沒打過牌的 LINE 帳號也在（0 張）；欠最多的在最上面；統計格數字
//   A5 單一玩家流水帳：同一房的扣卡收成一筆（列出第幾把），充值、回收、暫停、恢復各一筆，新的在前；老闆查不到自己的帳
//   M1 玩家自己的餘額：一般玩家有數字、老闆沒有、遊客沒有；被暫停時帶暫停時間；沒登入 401
import { setupThirteenDb } from "../support/thirteen-pg";
import { tokens } from "../support/stub-auth";
import { rooms, seats } from "../support/stub-db";
import { addUser, clock as cardClock, db as cardDb, failing } from "../support/stub-roomcard-store";
import { POST as thCreate } from "../../app/api/thirteen/create/route";
import { POST as thJoin } from "../../app/api/thirteen/join/route";
import { POST as thStart } from "../../app/api/thirteen/start/route";
import { GET as thState } from "../../app/api/thirteen/state/route";
import { POST as thSubmit } from "../../app/api/thirteen/submit/route";
import { POST as thNext } from "../../app/api/thirteen/next-game/route";
import { POST as mjCreate } from "../../app/api/mahjong/create/route";
import { POST as mjJoin } from "../../app/api/mahjong/join/route";
import { POST as mjStart } from "../../app/api/mahjong/start/route";
import { POST as mjNext } from "../../app/api/mahjong/next-game/route";
import { GET as adminPlayers } from "../../app/api/admin/cards/players/route";
import { GET as adminLedger } from "../../app/api/admin/cards/ledger/route";
import { POST as adminTopup } from "../../app/api/admin/cards/topup/route";
import { POST as adminReclaim } from "../../app/api/admin/cards/reclaim/route";
import { POST as adminSuspend } from "../../app/api/admin/cards/suspend/route";
import { POST as adminResume } from "../../app/api/admin/cards/resume/route";
import { GET as cardsMe } from "../../app/api/cards/me/route";
import { chargeThirteenHand } from "../../lib/roomCard/charge";
import { dealAndStart } from "../../lib/deal-and-start";
import { big2Rooms } from "../support/stub-records-store";
import { clock } from "../../lib/thirteen/flow";
import { autoArrange } from "../../lib/thirteen/arrange";
import { OWNER_USER_ID } from "../../lib/mahjong/zimoFx/rules";
import type { Card } from "../../lib/thirteen/cards";
import type { MahjongGameState } from "../../lib/mahjong/gameState";

const results: string[] = [];
function eq(a: unknown, e: unknown, msg: string) {
  const ok = JSON.stringify(a) === JSON.stringify(e);
  results.push(`${ok ? "✅" : "❌"} ${msg}${ok ? "" : `\n   預期=${JSON.stringify(e)}\n   實際=${JSON.stringify(a)}`}`);
}
const th = await setupThirteenDb();
const cards = await cardDb();
const NOW = Date.parse("2026-11-20T12:00:00Z");
clock.now = () => NOW;
cardClock.now = NOW;

// 帳號：a～e 是一般 LINE 玩家、boss 是老闆、guest 是遊客、quiet 是沒打過牌的 LINE 玩家
const U: Record<string, string> = { a: "00000000-0000-4000-8000-0000000000a1", b: "00000000-0000-4000-8000-0000000000b2", c: "00000000-0000-4000-8000-0000000000c3",
  d: "00000000-0000-4000-8000-0000000000d4", e: "00000000-0000-4000-8000-0000000000e5", boss: OWNER_USER_ID, guest: "00000000-0000-4000-8000-0000000000f6",
  quiet: "00000000-0000-4000-8000-000000000077" };
for (const [k, id] of Object.entries(U)) {
  tokens[`tk-${k}`] = { id, displayName: k, pictureUrl: null, isGuest: k === "guest" };
  await addUser(id, `玩家${k}`, k === "guest");
}
type Res = { status: number; body: Record<string, unknown> & { [k: string]: any } }; // eslint-disable-line @typescript-eslint/no-explicit-any
async function post(fn: (r: Request) => Promise<Response>, body: object, as: string | null): Promise<Res> {
  const r = await fn(new Request("http://x", { method: "POST", headers: { "content-type": "application/json", ...(as ? { authorization: `Bearer tk-${as}` } : {}) }, body: JSON.stringify(body) }));
  return { status: r.status, body: await r.json() };
}
async function get(fn: (r: Request) => Promise<Response>, query: string, as: string | null): Promise<Res> {
  const r = await fn(new Request(`http://x/?${query}`, { headers: as ? { authorization: `Bearer tk-${as}` } : {} }));
  return { status: r.status, body: await r.json() };
}
const ledger = async () => (await cards.query<{ user_id: string; game: string; room_id: string; room_code: string; hand_no: number; balance_after: number }>(
  `select user_id, game, room_id, room_code, hand_no, balance_after from room_card_ledger where kind = 'charge' order by id`)).rows;
const balance = async (k: string) => (await cards.query<{ balance: number }>(`select balance from room_card_accounts where user_id = $1`, [U[k]])).rows[0]?.balance ?? 0;
const chargesOf = async (k: string, roomId?: string) => (await ledger()).filter((r) => r.user_id === U[k] && (!roomId || r.room_id === roomId)).length;
let op = 0;
const opId = () => `00000000-0000-4000-9000-${String(++op).padStart(12, "0")}`;

// 十三支：players＝四個座位的帳號 key（座位 0 是房主）
async function thSeated(players: string[]) {
  const c = (await post(thCreate, { hostId: `h-${players[0]}`, arrangeSec: 30, totalHands: 8 }, players[0])).body as { roomId: string; code: string };
  for (const [i, k] of players.entries()) await post(thJoin, { code: c.code, playerId: i === 0 ? `h-${k}` : `x-${k}`, name: `玩家${k}` }, k);
  return { ...c, pids: players.map((k, i) => (i === 0 ? `h-${k}` : `x-${k}`)), keys: players };
}
async function thPlayHand(r: { roomId: string; pids: string[]; keys: string[] }) {
  for (const [i, p] of r.pids.entries()) {
    const v = (await get(thState, `roomId=${r.roomId}&playerId=${p}`, r.keys[i])).body;
    if (!v.me) return;
    const a = autoArrange(v.me.hand as Card[], { lucky: v.luckyCard?.rank ?? null });
    await post(thSubmit, { roomId: r.roomId, playerId: p, front: a.front.map((x) => x.id), middle: a.middle.map((x) => x.id), back: a.back.map((x) => x.id) }, r.keys[i]);
  }
}
async function thNextAll(r: { roomId: string; pids: string[]; keys: string[] }) {
  for (const [i, p] of r.pids.entries()) await post(thNext, { roomId: r.roomId, playerId: p, }, r.keys[i]);
}

// C1
{
  const r = await thSeated(["a", "b", "c", "boss"]);
  const st = await post(thStart, { roomId: r.roomId, playerId: r.pids[0] }, "a");
  for (let h = 1; h <= 8; h++) { await thPlayHand(r); if (h < 8) await thNextAll(r); }
  const gone = (await th.query<{ n: number }>(`select count(*)::int n from th_rooms where id = $1`, [r.roomId])).rows[0].n;
  const mine = (await ledger()).filter((x) => x.room_id === r.roomId);
  eq([st.status, gone, await chargesOf("a", r.roomId), await chargesOf("b", r.roomId), await chargesOf("c", r.roomId), await chargesOf("boss", r.roomId)], [200, 0, 4, 4, 4, 0],
    "C1 十三支 8 局打完：三位玩家各扣 4 張、老闆 0 張");
  eq([...new Set(mine.map((x) => x.hand_no))], [1, 3, 5, 7], "C1 扣在第 1、3、5、7 局");
  eq([mine.every((x) => x.game === "thirteen" && x.room_code === r.code), await balance("a"), mine.filter((x) => x.user_id === U.a).map((x) => x.balance_after)],
    [true, -4, [-1, -2, -3, -4]], "C1 流水帳記房號，餘額扣成負數（沒有下限）");
}
// C2
{
  const s = { handNo: 1, players: [U.d, U.e, null, U.boss].map((userId) => ({ userId })) };
  for (let i = 0; i < 3; i++) await chargeThirteenHand("room-c2", "0002", s);
  await Promise.all([1, 2, 3].map(() => chargeThirteenHand("room-c2", "0002", s)));
  eq([await chargesOf("d", "room-c2"), await chargesOf("e", "room-c2"), await balance("d")], [1, 1, -1], "C2 同一把重送 3 次、同時送 3 次：每人只扣 1 張");
}
// C3：麻將（stub-db 的房間，座位綁 a、b、c、boss）
async function mjRoom(id: string, keys: string[]) {
  rooms[id] = { id, code: `M${id}`, status: "waiting", host_id: "m0", game_state: { roomSettings: { totalRounds: 1, basePoints: 10, fanPoints: 10 } } as unknown as MahjongGameState };
  seats[id] = keys.map((k, i) => ({ player_id: `m${i}`, name: `玩家${k}`, seat: i, user_id: U[k] }));
}
const mjKeyOf = (id: string, pid: string) => { const s = seats[id].find((x) => x.player_id === pid)!; return Object.keys(U).find((k) => U[k] === s.user_id)!; };
async function mjFinishAndNext(id: string, dealerWins: boolean) {
  const s = rooms[id].game_state;
  s.status = "finished";
  s.winner = { seat: dealerWins ? s.dealerSeat : (s.dealerSeat + 1) % 4 } as MahjongGameState["winner"];
  s.handsCompleted = (s.handsCompleted ?? 0) + 1;
  rooms[id].status = "finished";
  const out: number[] = [];
  for (const p of s.players) out.push((await post(mjNext, { roomId: id, playerId: p.id }, mjKeyOf(id, p.id))).status);
  return out;
}
{
  await mjRoom("MJ1", ["a", "b", "c", "boss"]);
  const before = { a: await balance("a"), b: await balance("b"), c: await balance("c") };
  const st = await post(mjStart, { roomId: "MJ1", playerId: "m0" }, "a");
  const h1 = [await chargesOf("a", "MJ1"), await chargesOf("b", "MJ1"), await chargesOf("c", "MJ1"), await chargesOf("boss", "MJ1")];
  const n2 = await mjFinishAndNext("MJ1", true);  // 莊家胡 → 第 2 把連莊
  const h2 = await chargesOf("a", "MJ1");
  const n3 = await mjFinishAndNext("MJ1", false); // 下莊 → 第 3 把照扣
  const rows = (await ledger()).filter((x) => x.room_id === "MJ1");
  eq([st.status, h1], [200, [1, 1, 1, 0]], "C3 麻將開局：三位玩家各扣 1 張、老闆不扣");
  eq([n2.at(-1), h2, n3.at(-1), await chargesOf("a", "MJ1")], [200, 1, 200, 2], "C3 莊家胡 → 下一把連莊不扣；下莊那一把照扣");
  eq([[...new Set(rows.map((x) => x.hand_no))], rows.every((x) => x.game === "mahjong" && x.room_code === "MMJ1"), (await balance("a")) - before.a], [[1, 3], true, -2],
    "C3 扣在第 1、3 把（第 2 把是連莊），流水帳記遊戲和房號");
}
// C4
{
  await mjRoom("MJ4", ["d", "e", "b", "c"]);
  failing.on = true;
  const st = await post(mjStart, { roomId: "MJ4", playerId: "m0" }, "d");
  failing.on = false;
  eq([st.status, rooms.MJ4.status, rooms.MJ4.game_state.players.every((p) => p.hand.length >= 13), await chargesOf("d", "MJ4")], [200, "playing", true, 0],
    "C4 扣卡失敗（資料庫錯誤）不擋開局：牌照發、路由 200（只寫 log）");
}

// C5
{
  const before = (await ledger()).length;
  big2Rooms.B2 = { room: { id: "B2", code: "2222", status: "waiting", updated_at: new Date(NOW).toISOString(), row_version: 0 } as never,
    players: ["a", "b", "c", "d"].map((k, seat) => ({ player_id: `b${seat}`, name: `玩家${k}`, seat })) as never };
  const ok = await dealAndStart("B2", "2222");
  eq([ok, big2Rooms.B2.room.status, (await ledger()).length - before], [true, "playing", 0], "C5 大老二開局：照常發牌開打，不扣卡（流水帳沒多任何一筆）");
}

// S3 的房先開好：打到一半才被暫停（十三支，a 是房主）
const mid = await thSeated(["d", "a", "b", "c"]);
await post(thStart, { roomId: mid.roomId, playerId: mid.pids[0] }, "d");
await thPlayHand(mid);
// S2 的房先開好：b 坐在等人中的房
const lobbyTh = await thSeated(["c", "b", "e", "d"]);
await mjRoom("MJ2", ["c", "b", "e", "d"]);

// A1
{
  const routes: [string, (r: Request) => Promise<Response>, "get" | "post"][] = [["players", adminPlayers, "get"], ["ledger", adminLedger, "get"],
    ["topup", adminTopup, "post"], ["reclaim", adminReclaim, "post"], ["suspend", adminSuspend, "post"], ["resume", adminResume, "post"]];
  const out: string[] = [];
  const before = await balance("b");
  for (const [name, fn, m] of routes) {
    for (const who of [null, "a", "guest"]) {
      const r = m === "get" ? await get(fn, `userId=${U.b}`, who) : await post(fn, { userId: U.b, cards: 5, opId: opId() }, who);
      out.push(`${name}:${who}:${r.status}:${r.body.error}`);
    }
  }
  eq(out.filter((x) => !/:(null:401:not_logged_in|a:403:forbidden|guest:403:forbidden)$/.test(x)), [], "A1 後台 6 支 API：沒登入 401、一般玩家和遊客 403");
  eq([await balance("b") - before, (await cards.query(`select * from room_card_audit`)).rows.length], [0, 0], "A1 被擋下的請求什麼都沒寫（餘額沒變、沒有暫停紀錄）");
}
// S1
{
  const s = await post(adminSuspend, { userId: U.b, opId: opId() }, "boss");
  const thc = await post(thCreate, { hostId: "hb", arrangeSec: 30, totalHands: 8 }, "b");
  const mjc = await post(mjCreate, { hostId: "hb" }, "b");
  const fresh = (await post(thCreate, { hostId: "he", arrangeSec: 30, totalHands: 8 }, "e")).body as { code: string };
  const thj = await post(thJoin, { code: fresh.code, playerId: "xb2", name: "玩家b" }, "b");
  const mjFresh = (await post(mjCreate, { hostId: "he" }, "e")).body as { code: string };
  const mjj = await post(mjJoin, { code: mjFresh.code, playerId: "xb3", name: "玩家b" }, "b");
  eq([s.status, s.body.suspended, typeof s.body.suspendedAt], [200, true, "number"], "S1 老闆暫停 b");
  eq([thc.status, thc.body.error, mjc.status, mjc.body.error, thc.body.suspendedAt === s.body.suspendedAt], [403, "suspended", 403, "suspended", true],
    "S1 被暫停的人十三支、麻將開房都 403 suspended（附暫停時間）");
  eq([thj.status, thj.body.error, mjj.status, mjj.body.error], [403, "suspended", 403, "suspended"], "S1 被暫停的人加入別人的新房也 403 suspended");
}
// S2
{
  const t = await post(thStart, { roomId: lobbyTh.roomId, playerId: lobbyTh.pids[0] }, "c");
  const m = await post(mjStart, { roomId: "MJ2", playerId: "m0" }, "c");
  eq([t.status, t.body.error, t.body.players, m.status, m.body.error, m.body.players], [403, "player_suspended", [{ seat: 1, name: "玩家b" }], 403, "player_suspended", [{ seat: 1, name: "玩家b" }]],
    "S2 房裡有人被暫停：十三支、麻將房主開局都 403 player_suspended，回那個人的座位和名字");
  eq([rooms.MJ2.status, await chargesOf("c", "MJ2"), await chargesOf("c", lobbyTh.roomId)], ["waiting", 0, 0], "S2 開局被擋：房間還在等人，沒有人被扣卡");
}
// S3
{
  const before = await chargesOf("b", mid.roomId);
  const back = await post(thJoin, { code: mid.code, playerId: mid.pids[2], name: "玩家b" }, "b");
  await thNextAll(mid);  // 第 2 局（不扣）
  await thPlayHand(mid);
  await thNextAll(mid);  // 第 3 局（扣）
  const v = (await get(thState, `roomId=${mid.roomId}&playerId=${mid.pids[2]}`, "b")).body;
  eq([back.status, back.body.rejoined, v.handNo, before, await chargesOf("b", mid.roomId)], [200, true, 3, 1, 2],
    "S3 打到一半被暫停：重新加入自己的座位照常、照常打到第 3 局、第 3 局照常扣卡");
}
// S4
{
  const r = await post(adminResume, { userId: U.b, opId: opId() }, "boss");
  const thc = await post(thCreate, { hostId: "hb4", arrangeSec: 30, totalHands: 8 }, "b");
  const mjc = await post(mjCreate, { hostId: "hb4" }, "b");
  eq([r.status, r.body.suspended, r.body.suspendedAt, thc.status, mjc.status], [200, false, null, 200, 200], "S4 恢復之後照常開房");
}
// A2
{
  const o1 = opId();
  const before = await balance("c");
  const t1 = await post(adminTopup, { userId: U.c, cards: 50, opId: o1 }, "boss");
  const t2 = await post(adminTopup, { userId: U.c, cards: 50, opId: o1 }, "boss");
  const t3 = await post(adminReclaim, { userId: U.c, cards: 50, opId: o1 }, "boss");
  eq([t1.status, t1.body.balance, t1.body.replay, t2.status, t2.body.balance, t2.body.replay, await balance("c")], [200, before + 50, false, 200, before + 50, true, before + 50],
    "A2 充值 50：同一個操作編號重送只加一次，回第一次的餘額");
  eq([t3.status, t3.body.error], [409, "op_conflict"], "A2 同一個操作編號拿去回收：409 op_conflict，什麼都不動");
  const r1 = await post(adminReclaim, { userId: U.c, cards: before + 60, opId: opId() }, "boss");
  eq([r1.status, r1.body.balance, await balance("c")], [200, -10, -10], "A2 回收可以收到負數（沒有下限）");
  const s1 = opId();
  const a = await post(adminSuspend, { userId: U.e, opId: s1 }, "boss");
  const b = await post(adminSuspend, { userId: U.e, opId: s1 }, "boss");
  const n = (await cards.query(`select * from room_card_audit where user_id = $1`, [U.e])).rows.length;
  await post(adminResume, { userId: U.e, opId: opId() }, "boss");
  eq([a.status, b.status, b.body.replay, b.body.suspendedAt === a.body.suspendedAt, n], [200, 200, true, true, 1], "A2 暫停同一個操作編號重送只記一次");
}
// A6
{
  const audits = async () => Number((await cards.query<{ n: number }>(`select count(*)::int n from room_card_audit where user_id = $1`, [U.e])).rows[0].n);
  const susp = async () => (await get(cardsMe, "", "e")).body.suspended;
  // 案例一：本來正常 → 恢復 A（沒變）→ 暫停 B → 重送恢復 A：要維持暫停
  const before1 = await audits();
  const oA = opId(), oB = opId();
  const a1 = await post(adminResume, { userId: U.e, opId: oA }, "boss");
  const b1 = await post(adminSuspend, { userId: U.e, opId: oB }, "boss");
  const a1again = await post(adminResume, { userId: U.e, opId: oA }, "boss");
  eq([a1.status, a1.body.replay, b1.body.suspended, a1again.status, a1again.body.replay, a1again.body.suspended, await susp(), (await audits()) - before1],
    [200, false, true, 200, true, true, true, 1], "A6 案例一：本來正常→恢復 A（沒變）→暫停 B→重送恢復 A：認得是重送、維持暫停，只多 B 那 1 筆紀錄");
  // 案例二：已暫停 → 暫停 C（沒變）→ 恢復 D → 重送暫停 C：要維持正常
  const before2 = await audits();
  const oC = opId(), oD = opId();
  const c1 = await post(adminSuspend, { userId: U.e, opId: oC }, "boss");
  const d1 = await post(adminResume, { userId: U.e, opId: oD }, "boss");
  const c1again = await post(adminSuspend, { userId: U.e, opId: oC }, "boss");
  eq([c1.status, c1.body.replay, d1.body.suspended, c1again.status, c1again.body.replay, c1again.body.suspended, await susp(), (await audits()) - before2],
    [200, false, false, 200, true, false, false, 1], "A6 案例二：已暫停→暫停 C（沒變）→恢復 D→重送暫停 C：認得是重送、維持正常，只多 D 那 1 筆紀錄");
  // 狀態沒變的操作編號拿去做別的事：409、什麼都不動
  const bal = await balance("e");
  const x = [(await post(adminSuspend, { userId: U.e, opId: oA }, "boss")), (await post(adminResume, { userId: U.d, opId: oA }, "boss")),
    (await post(adminTopup, { userId: U.e, cards: 5, opId: oA }, "boss")), (await post(adminResume, { userId: U.e, opId: oB }, "boss"))];
  eq([x.map((r) => `${r.status}:${r.body.error}`), await susp(), await balance("e"), (await audits()) - before2],
    [["409:op_conflict", "409:op_conflict", "409:op_conflict", "409:op_conflict"], false, bal, 1], "A6 同一個編號換動作、換人、拿去充值都是 409 op_conflict，狀態、餘額、紀錄都沒變");
}
// A3
{
  const bad = [];
  for (const c of [0, -1, 1.5, "5", 100001, null]) bad.push((await post(adminTopup, { userId: U.c, cards: c, opId: opId() }, "boss")).status);
  const noOp = await post(adminTopup, { userId: U.c, cards: 5 }, "boss");
  const badUser = await post(adminTopup, { userId: "nope", cards: 5, opId: opId() }, "boss");
  const owner = await post(adminTopup, { userId: U.boss, cards: 5, opId: opId() }, "boss");
  const ownerSus = await post(adminSuspend, { userId: U.boss, opId: opId() }, "boss");
  const guest = await post(adminTopup, { userId: U.guest, cards: 5, opId: opId() }, "boss");
  const ghost = await post(adminReclaim, { userId: "00000000-0000-4000-8000-000000000999", cards: 5, opId: opId() }, "boss");
  eq([bad, noOp.status, badUser.status], [[400, 400, 400, 400, 400, 400], 400, 400], "A3 張數不是 1～100000 的整數、沒有操作編號、帳號格式不對：400");
  eq([owner.status, owner.body.error, ownerSus.body.error, guest.body.error, ghost.body.error], [400, "owner_exempt", "owner_exempt", "unknown_player", "unknown_player"],
    "A3 老闆帳號不能操作；遊客、不存在的帳號 unknown_player");
  eq((await cards.query(`select * from room_card_accounts where user_id = any($1::uuid[])`, [[U.boss, U.guest]])).rows.length, 0, "A3 老闆、遊客都沒有房卡帳戶");
}
// A4
{
  const r = await get(adminPlayers, "", "boss");
  const list = r.body.players as { userId: string; balance: number; suspended: boolean; name: string; lastTopupAt: number | null; lastChargeAt: number | null }[];
  const ids = list.map((p) => p.userId);
  eq([r.status, ids.includes(U.boss), ids.includes(U.guest), list.find((p) => p.userId === U.quiet)?.balance], [200, false, false, 0],
    "A4 玩家名單：沒有老闆、沒有遊客；沒打過牌的 LINE 帳號也在（0 張）");
  eq(list.map((p) => p.balance), [...list.map((p) => p.balance)].sort((x, y) => x - y), "A4 照餘額由少到多排（欠最多的在最上面）");
  const debt = list.filter((p) => p.balance < 0);
  eq(r.body.stats, { players: list.length, debtors: debt.length, debtCards: -debt.reduce((s, p) => s + p.balance, 0), suspended: 0,
    chargedToday: Number((await cards.query<{ n: number }>(`select count(*)::int n from room_card_ledger where kind = 'charge'`)).rows[0].n) }, "A4 統計格：玩家、欠卡人數和張數、暫停中、今天扣卡");
  const c = list.find((p) => p.userId === U.c)!;
  eq([c.name, typeof c.lastTopupAt, typeof c.lastChargeAt], ["玩家c", "number", "number"], "A4 每一列有名字、上次充值、上次扣卡");
}
// A5
{
  const r = await get(adminLedger, `userId=${U.c}`, "boss");
  const e = r.body.entries as { kind: string; cards: number | null; game?: string; roomCode?: string; hands?: number[]; balanceAfter: number | null }[];
  const kinds = e.map((x) => x.kind);
  const th1 = e.find((x) => x.kind === "charge" && x.game === "thirteen" && x.hands?.length === 4);
  eq([r.status, r.body.player?.userId, kinds.filter((k) => k === "topup").length, kinds.filter((k) => k === "reclaim").length], [200, U.c, 1, 1], "A5 流水帳：充值、回收各一筆");
  eq([th1?.cards, th1?.hands], [-4, [1, 3, 5, 7]], "A5 同一房的扣卡收成一筆，列出第幾局");
  eq(kinds[0], "reclaim", "A5 新的在前（最後一筆是回收）");
  const b = (await get(adminLedger, `userId=${U.b}`, "boss")).body.entries as { kind: string }[];
  eq(b.filter((x) => x.kind === "suspend" || x.kind === "resume").map((x) => x.kind), ["resume", "suspend"], "A5 暫停、恢復也在流水帳");
  const own = await get(adminLedger, `userId=${U.boss}`, "boss");
  eq([own.status, own.body.error], [400, "owner_exempt"], "A5 老闆查不到自己的帳");
}
// M1
{
  await post(adminSuspend, { userId: U.d, opId: opId() }, "boss");
  const d = await get(cardsMe, "", "d");
  const boss = await get(cardsMe, "", "boss");
  const guest = await get(cardsMe, "", "guest");
  const anon = await get(cardsMe, "", null);
  eq([d.status, d.body.isOwner, d.body.balance, d.body.suspended, typeof d.body.suspendedAt], [200, false, await balance("d"), true, "number"], "M1 一般玩家：自己的餘額、暫停時間");
  eq([boss.body.isOwner, boss.body.balance, guest.body.balance, anon.status], [true, null, null, 401], "M1 老闆、遊客沒有餘額；沒登入 401");
}

console.log(results.join("\n"));
if (results.some((r) => r.startsWith("❌"))) process.exit(1);
