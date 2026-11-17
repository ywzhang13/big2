// 十三支進出房、找回房間、閒置清除、觀戰、對局紀錄（老柯 2026-11-18）。和 flow-thirteen.ts 一樣，路由、db 層、SQL 都是真的
// （PGlite 跑真 migration），只有登入、廣播、觀戰資料表（另一個 PGlite 跑真的 20261030_mahjong_spectate.sql）用 tests/support 的替身。
//   L  等人階段離開：一般玩家、房主（交給最早入座的人）、最後一人（關房不記）、外人／已開局擋下
//   K  入座、離開、開局、空房關閉、閒置清除的每一種先後順序（審伯必修 1～3）：牌局玩家＝座位表、房主在房裡、不留孤兒座位
//   R  找回房間：只認登入身分；斷線重進認回原座位和手牌；外人、遊客、已離開、已關房都拿不到
//   G  閒置清除（規則同麻將）：等人 2 小時、開局後 12 小時沒寫入才清；選中後有人動過就不清（進行中的房不會被刪）
//   P  觀戰：申請 → 被申請者同意 → 亮牌前一張牌都看不到、能讀聊天不能發言；沒同意、別人代答、收回、自己這桌都擋下
//   H  我的對局紀錄：只回自己的十三支場次（分頁、累計），麻將場次不混進來；函式權限只給伺服器；可回滾
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setupThirteenDb } from "../support/thirteen-pg";
import { tokens } from "../support/stub-auth";
import { sent } from "../support/stub-broadcast";
import { loadRoomSpectate } from "../support/stub-spectate-store";
import { POST as createRoute } from "../../app/api/thirteen/create/route";
import { POST as joinRoute } from "../../app/api/thirteen/join/route";
import { POST as startRoute } from "../../app/api/thirteen/start/route";
import { GET as stateRoute } from "../../app/api/thirteen/state/route";
import { POST as submitRoute } from "../../app/api/thirteen/submit/route";
import { POST as tickRoute } from "../../app/api/thirteen/tick/route";
import { POST as leaveReqRoute } from "../../app/api/thirteen/leave-request/route";
import { POST as leaveVoteRoute } from "../../app/api/thirteen/leave-vote/route";
import { POST as chatRoute } from "../../app/api/thirteen/chat/route";
import { GET as historyRoute } from "../../app/api/thirteen/chat/history/route";
import { POST as leaveRoute } from "../../app/api/thirteen/leave/route";
import { GET as myRoomRoute } from "../../app/api/thirteen/my-room/route";
import { GET as recordsRoute } from "../../app/api/thirteen/records/route";
import { GET as spRoomRoute } from "../../app/api/thirteen/spectate/room/route";
import { POST as spRequestRoute } from "../../app/api/thirteen/spectate/request/route";
import { POST as spRespondRoute } from "../../app/api/thirteen/spectate/respond/route";
import { GET as spManageRoute } from "../../app/api/thirteen/spectate/manage/route";
import { POST as spRevokeRoute } from "../../app/api/thirteen/spectate/revoke/route";
import { GET as spViewRoute } from "../../app/api/thirteen/spectate/view/route";
import { clock, NEXT_HAND_MAX_MS } from "../../lib/thirteen/flow";
import { closeIdleRoom, privateChannel, publicChannel, sweepIdleThirteenRooms } from "../../lib/thirteen/server";
import { listIdleThirteenRooms } from "../../lib/thirteen/db";
import { spectatorChannelName } from "../../lib/mahjong/access";
import type { Card } from "../../lib/thirteen/cards";
import { autoArrange } from "../../lib/thirteen/arrange";

const results: string[] = [];
function eq(a: unknown, e: unknown, msg: string) {
  const ok = JSON.stringify(a) === JSON.stringify(e);
  results.push(`${ok ? "✅" : "❌"} ${msg}${ok ? "" : `\n   預期=${JSON.stringify(e)}\n   實際=${JSON.stringify(a)}`}`);
}
const db = await setupThirteenDb();
let NOW = Date.parse("2026-11-18T12:00:00Z");
clock.now = () => NOW;

const PIDS = ["p0", "p1", "p2", "p3", "p4"];
const uid = (i: number) => `00000000-0000-4000-8000-0000000000b${i}`;
PIDS.forEach((p, i) => { tokens[`tk-${p}`] = { id: uid(i), displayName: `玩家${i}`, pictureUrl: null, isGuest: false }; });
tokens["tk-watch"] = { id: "00000000-0000-4000-8000-0000000000c9", displayName: "觀戰員", pictureUrl: null, isGuest: false };
tokens["tk-guest"] = { id: "00000000-0000-4000-8000-0000000000e1", displayName: null, pictureUrl: null, isGuest: true };
const auth = (as?: string): Record<string, string> => (as ? { authorization: `Bearer tk-${as}` } : {});
async function post(fn: (r: Request) => Promise<Response>, body: object, as?: string) {
  const r = await fn(new Request("http://x", { method: "POST", headers: { "content-type": "application/json", ...auth(as) }, body: JSON.stringify(body) }));
  return { status: r.status, body: await r.json() };
}
async function get(fn: (r: Request) => Promise<Response>, q: string, as?: string) {
  const r = await fn(new Request(`http://x/?${q}`, { headers: auth(as) }));
  return { status: r.status, body: await r.json() };
}
const state = (roomId: string, as: string, playerId: string | null = as) => get(stateRoute, `roomId=${roomId}${playerId ? `&playerId=${playerId}` : ""}`, as);
const ids = (cs: Card[]) => cs.map((c) => c.id);
async function lobby(seats: string[], totalHands = 16) {
  const c = await post(createRoute, { hostId: seats[0], arrangeSec: 30, totalHands }, seats[0]);
  for (const [i, p] of seats.entries()) await post(joinRoute, { code: c.body.code, playerId: p, name: `玩家${i}` }, p);
  return { roomId: c.body.roomId as string, code: c.body.code as string };
}
async function newMatch(seats: string[] = PIDS.slice(0, 4), totalHands = 16) {
  const m = await lobby(seats, totalHands);
  await post(startRoute, { roomId: m.roomId, playerId: seats[0] }, seats[0]);
  return m;
}
async function submitAll(roomId: string, who: string[]) {
  for (const p of who) {
    const a = autoArrange((await state(roomId, p)).body.me.hand as Card[]);
    await post(submitRoute, { roomId, playerId: p, front: ids(a.front), middle: ids(a.middle), back: ids(a.back) }, p);
  }
}
const roomN = async (id: string) => (await db.query<{ n: number }>(`select count(*)::int n from th_rooms where id = $1`, [id])).rows[0].n;
const seatsOf = async (id: string) => (await db.query<{ player_id: string }>(`select player_id from th_players where room_id = $1 order by seat`, [id])).rows.map((r) => r.player_id);
const recOf = async (id: string) => (await db.query<{ end_reason: string }>(`select end_reason from match_records where room_id = $1`, [id])).rows[0] ?? null;
const chatRows = async (id: string) => (await db.query<{ n: number }>(`select count(*)::int n from mj_chat_messages where room_id = $1`, [id])).rows[0].n;
/** 把房間的最後活動時間往回調（真的資料庫由 trigger 填；暫時關掉 trigger，row_version 不變） */
async function ageRoom(id: string, hours: number) {
  await db.exec(`alter table th_rooms disable trigger trg_th_rooms_updated_at`);
  await db.query(`update th_rooms set updated_at = now() - make_interval(hours => $2) where id = $1`, [id, hours]);
  await db.exec(`alter table th_rooms enable trigger trg_th_rooms_updated_at`);
}

// ---------- L 等人階段離開 ----------
{
  const m = await lobby(["p0", "p1", "p2", "p3"]);
  const b = sent.length;
  const l2 = await post(leaveRoute, { roomId: m.roomId }, "p2");
  const ev = sent.slice(b).filter((e) => e.event === "th_player_left");
  const lobbyView = await state(m.roomId, "p0");
  eq([l2.status, l2.body, await seatsOf(m.roomId), ev.map((e) => [e.channel === publicChannel(m.code), e.payload.playerId, e.payload.playerCount, e.payload.hostId]),
    lobbyView.body.hostId, (await get(myRoomRoute, "", "p2")).body.room],
    [200, { ok: true, hostId: "p0", closed: false }, ["p0", "p1", "p3"], [[true, "p2", 3, "p0"]], "p0", null],
    "L1 一般玩家在等人時離開：座位刪掉、房主不變、公開頻道通知（剩 3 人）；他的找回房間變成沒有");

  // 房主離開 → 交給最早入座、還在房裡的 p1；p1 補滿人後能開局，原房主不行
  const l0 = await post(leaveRoute, { roomId: m.roomId }, "p0");
  const after0 = await state(m.roomId, "p1");
  await post(joinRoute, { code: m.code, playerId: "p2", name: "回來" }, "p2");
  await post(joinRoute, { code: m.code, playerId: "p4", name: "新人" }, "p4");
  const oldHostStart = await post(startRoute, { roomId: m.roomId, playerId: "p0" }, "p0");
  const newHostStart = await post(startRoute, { roomId: m.roomId, playerId: "p1" }, "p1");
  eq([l0.body, after0.body.hostId, oldHostStart.status, newHostStart.status, (await db.query<{ s: string }>(`select status s from th_rooms where id = $1`, [m.roomId])).rows[0].s],
    [{ ok: true, hostId: "p1", closed: false }, "p1", 403, 200, "playing"],
    "L2 房主離開：房主交給最早入座的 p1（比照麻將），他補滿 4 人後能開局；已離開的原房主開不了");

  // 已開局不能用離開（要走解散投票）；外人、沒登入擋下
  const started = await post(leaveRoute, { roomId: m.roomId }, "p3");
  const outsider = await post(leaveRoute, { roomId: m.roomId }, "watch");
  const noLogin = await post(leaveRoute, { roomId: m.roomId });
  const bad = await post(leaveRoute, { roomId: "not-a-uuid" }, "p1");
  eq([started.status, started.body.error, outsider.status, outsider.body.error, noLogin.status, bad.status, (await seatsOf(m.roomId)).length],
    [409, "game_in_progress", 404, "not_in_room", 401, 400, 4],
    "L3 已開局 409（改走解散投票）；不在房裡的人 404 not_in_room（離開只認登入身分，不能讓別人離開）；沒登入 401；座位一個都沒少");

  // 最後一個人離開 → 關房、不寫紀錄、聊天一起刪
  const solo = await lobby(["p0"]);
  await post(chatRoute, { roomId: solo.roomId, text: "有人嗎" }, "p0");
  const chatBefore = await chatRows(solo.roomId);
  const last = await post(leaveRoute, { roomId: solo.roomId }, "p0");
  eq([chatBefore, last.body, await roomN(solo.roomId), await recOf(solo.roomId), await chatRows(solo.roomId), (await post(leaveRoute, { roomId: solo.roomId }, "p0")).status],
    [1, { ok: true, hostId: null, closed: true }, 0, null, 0, 404],
    "L4 最後一個人離開：關房（一局都沒打，不寫紀錄），聊天紀錄一起刪；再按一次 404");
}

// ---------- K 入座、離開、開局、空房關閉、閒置清除的先後順序（審伯 2026-11-18 必修 1～3）----------
// 入座、離開都在資料庫函式裡鎖住房間那一列一次做完（20261118_thirteen_lobby.sql），所以任兩個動作只會「一個先、一個後」。
// 這裡把每一種先後順序都實際跑一次，每次都檢查「牌局玩家＝座位表、房主在房裡、房主帳號對得上」。
{
  /** 房間現況：牌局玩家、座位表、房主（房間不在回 null） */
  async function snap(id: string) {
    const r = (await db.query<{ host_id: string; status: string; gs: { hostUserId: string | null; players: { id: string; userId: string; seat: number }[] } }>(
      `select host_id, status, game_state gs from th_rooms where id = $1`, [id])).rows[0];
    const seats = (await db.query<{ player_id: string; user_id: string; seat: number }>(`select player_id, user_id, seat from th_players where room_id = $1 order by seat`, [id])).rows;
    if (!r) return { room: null, orphanSeats: seats.length };
    const hostSeat = seats.find((x) => x.player_id === r.host_id);
    return { room: r.status, seats: seats.map((x) => `${x.seat}:${x.player_id}`),
      game: (r.gs.players ?? []).map((p) => `${p.seat}:${p.id}`),
      gameMatchesSeats: r.status === "waiting" || JSON.stringify((r.gs.players ?? []).map((p) => [p.seat, p.id, p.userId])) === JSON.stringify(seats.map((x) => [x.seat, x.player_id, x.user_id])),
      host: r.host_id, hostSeated: !!hostSeat, hostUserOk: !!hostSeat && hostSeat.user_id === r.gs.hostUserId };
  }
  const lobbyLeave = (roomId: string, who: number) => db.query(`select th_lobby_leave($1::uuid, $2::uuid) r`, [roomId, uid(who)]);
  const lobbyJoin = (roomId: string, pid: string, who: number) => db.query(`select th_lobby_join($1::uuid, $2, $3, $4::uuid) r`, [roomId, pid, pid, uid(who)]);

  // 必修 1：最後一人離開 vs 有人入座，兩種順序
  const a = await lobby(["p0"]);
  await post(joinRoute, { code: a.code, playerId: "p1", name: "先到" }, "p1");      // 入座在前
  const la = await post(leaveRoute, { roomId: a.roomId }, "p0");
  const startA = await post(startRoute, { roomId: a.roomId, playerId: "p1" }, "p1");
  eq([la.body, await snap(a.roomId), startA.body.error], [{ ok: true, hostId: "p1", closed: false },
    { room: "waiting", seats: ["1:p1"], game: [], gameMatchesSeats: true, host: "p1", hostSeated: true, hostUserOk: true }, "not_full"],
    "K1 有人先入座、房主再離開：房間不關，房主（座位和帳號）交給剛入座的 p1，他按開局只差人數（not_full），不是 not_host");
  const b = await lobby(["p0"]);
  const lb = await post(leaveRoute, { roomId: b.roomId }, "p0");                     // 離開在前
  const jb = await post(joinRoute, { code: b.code, playerId: "p1", name: "晚到" }, "p1");
  eq([lb.body, jb.status, jb.body.error, await snap(b.roomId)], [{ ok: true, hostId: null, closed: true }, 404, "room_not_found", { room: null, orphanSeats: 0 }],
    "K2 最後一人先離開、再有人入座：房間已關，入座 404，不會留下沒有房間的座位");
  // 同時送（兩個請求一起發出，誰先拿到房間那一列的鎖由資料庫決定）：不管誰先，都是上面兩種結果之一
  const outcomes: string[] = [];
  for (const order of [0, 1]) {
    const c = await lobby(["p0"]);
    const reqs = [() => post(leaveRoute, { roomId: c.roomId }, "p0"), () => post(joinRoute, { code: c.code, playerId: "p1", name: "同時" }, "p1")];
    const [l, j] = order === 0 ? await Promise.all([reqs[0](), reqs[1]()]) : (await Promise.all([reqs[1](), reqs[0]()])).reverse();
    const sn = await snap(c.roomId);
    const ok = sn.room === null ? l.body.closed === true && j.status === 404 && sn.orphanSeats === 0
      : l.body.hostId === "p1" && j.status === 200 && sn.hostSeated && sn.hostUserOk && JSON.stringify(sn.seats) === JSON.stringify(["1:p1"]);
    outcomes.push(`${order}:${sn.room === null ? "關房" : "交接"}:${ok}`);
  }
  eq(outcomes.map((x) => x.endsWith(":true")), [true, true], `K3 最後一人離開和入座同時送（兩種發送順序）：結果只會是「關房＋入座 404」或「房主交給入座的人」，不會有沒房主的房、也不會有沒房間的座位（${outcomes.join("、")}）`);

  // 必修 2：入座刷新房間活動時間，舊的閒置清除快照失效
  const d = await lobby(["p0"]);
  await ageRoom(d.roomId, 3);
  const before = (await db.query<{ v: number }>(`select row_version::int v from th_rooms where id = $1`, [d.roomId])).rows[0].v;
  const picked = (await listIdleThirteenRooms(new Date(Date.now() - 2 * 3600_000).toISOString(), new Date(Date.now() - 12 * 3600_000).toISOString(), 50)).find((r) => r.id === d.roomId);
  await post(joinRoute, { code: d.code, playerId: "p1", name: "剛好入座" }, "p1");   // 選中之後、清除之前入座
  const fresh = (await db.query<{ v: number; age: number }>(`select row_version::int v, extract(epoch from now() - updated_at)::int age from th_rooms where id = $1`, [d.roomId])).rows[0];
  const res = await closeIdleRoom(picked!);
  const again = (await listIdleThirteenRooms(new Date(Date.now() - 2 * 3600_000).toISOString(), new Date(Date.now() - 12 * 3600_000).toISOString(), 50)).some((r) => r.id === d.roomId);
  eq([!!picked, fresh.v > before, fresh.age < 60, res, (await snap(d.roomId)).seats, again], [true, true, true, "changed", ["0:p0", "1:p1"], false],
    "K4 清除選中等人 3 小時的房之後有人入座：入座更新了活動時間和 row_version，舊快照關房回 changed，房間和兩個座位都在，下一輪清除也不會再選它");
  const e = await lobby(["p0"]);
  await ageRoom(e.roomId, 3);
  const pickedE = (await listIdleThirteenRooms(new Date(Date.now() - 2 * 3600_000).toISOString(), new Date(Date.now() - 12 * 3600_000).toISOString(), 50)).find((r) => r.id === e.roomId);
  const resE = await closeIdleRoom(pickedE!);                                        // 清除在前
  const je = await post(joinRoute, { code: e.code, playerId: "p1", name: "晚到" }, "p1");
  eq([resE, je.status, await snap(e.roomId)], ["closed", 404, { room: null, orphanSeats: 0 }], "K5 清除先關掉閒置房、之後才有人入座：入座 404，不會留下沒有房間的座位");

  // 必修 3：開局 vs 離開＋補位
  // (a) 開局讀完座位之後、存檔之前，p3 離開、p4 補進 p3 的位子 → 開局的存檔版本對不上，重讀用新的四個人開局
  const f = await lobby(["p0", "p1", "p2", "p3"]);
  const realFetch = globalThis.fetch;
  let armed = true, injected = false;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const r = await realFetch(input, init);
    if (armed && (init?.method ?? "GET").toUpperCase() === "GET" && String(input).includes("/th_players")) {
      armed = false; injected = true;
      await lobbyLeave(f.roomId, 3); await lobbyJoin(f.roomId, "p4", 4);
    }
    return r;
  }) as typeof fetch;
  const sf = await post(startRoute, { roomId: f.roomId, playerId: "p0" }, "p0");
  globalThis.fetch = realFetch;
  const snF = await snap(f.roomId);
  const p4View = await state(f.roomId, "p4");
  const p3View = await state(f.roomId, "p3");
  eq([injected, sf.status, snF.room, snF.game, snF.gameMatchesSeats, p4View.body.me?.hand?.length, p3View.status, (await get(myRoomRoute, "", "p3")).body.room?.roomId === f.roomId],
    [true, 200, "playing", ["0:p0", "1:p1", "2:p2", "3:p4"], true, 16, 403, false],
    "K6 開局讀完座位後 p3 離開、p4 補位：開局的存檔衝突、重讀後用 p0、p1、p2、p4 開局——牌局玩家和座位表一致，p4 拿得到手牌，p3 不在牌局、找回房間也不會回這間");
  // (a2) 開局讀完座位之後、存檔之前，只有 p3 離開（沒人補）→ 開局的存檔衝突、重讀只剩 3 人而不開局（不會開出一局有 p3、座位表卻沒有他的牌局）
  const f2 = await lobby(["p0", "p1", "p2", "p3"]);
  let armed2 = true;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const r = await realFetch(input, init);
    if (armed2 && (init?.method ?? "GET").toUpperCase() === "GET" && String(input).includes("/th_players")) { armed2 = false; await lobbyLeave(f2.roomId, 3); }
    return r;
  }) as typeof fetch;
  const sf2 = await post(startRoute, { roomId: f2.roomId, playerId: "p0" }, "p0");
  globalThis.fetch = realFetch;
  eq([armed2, sf2.status, sf2.body.error, await snap(f2.roomId)], [false, 400, "not_full",
    { room: "waiting", seats: ["0:p0", "1:p1", "2:p2"], game: [], gameMatchesSeats: true, host: "p0", hostSeated: true, hostUserOk: true }],
    "K6b 開局讀完 4 個座位後、存檔前 p3 離開：離開把牌局版本 +1，開局的存檔衝突、重讀只剩 3 人 → 400 not_full，不會開出座位表對不上的牌局");
  // (b) 開局先存檔 → 之後的離開 409、入座 400，牌局和座位都不變
  const g = await lobby(["p0", "p1", "p2", "p3"]);
  await post(startRoute, { roomId: g.roomId, playerId: "p0" }, "p0");
  const lg = await post(leaveRoute, { roomId: g.roomId }, "p3");
  const jg = await post(joinRoute, { code: g.code, playerId: "p4", name: "晚到" }, "p4");
  const snG = await snap(g.roomId);
  eq([lg.status, lg.body.error, jg.status, jg.body.error, snG.game, snG.gameMatchesSeats], [409, "game_in_progress", 400, "started", ["0:p0", "1:p1", "2:p2", "3:p3"], true],
    "K7 開局先存檔、之後才離開和補位：離開 409、補位 400 started，牌局玩家和座位表都不變");
  // (c) 先離開、再補位（補進同一個座位號碼）、再開局 → 一致
  const h = await lobby(["p0", "p1", "p2", "p3"]);
  await post(leaveRoute, { roomId: h.roomId }, "p1");
  const jh = await post(joinRoute, { code: h.code, playerId: "p4", name: "補位" }, "p4");
  const sh = await post(startRoute, { roomId: h.roomId, playerId: "p0" }, "p0");
  const snH = await snap(h.roomId);
  eq([jh.body.seat, sh.status, snH.game, snH.gameMatchesSeats], [1, 200, ["0:p0", "1:p4", "2:p2", "3:p3"], true],
    "K8 先離開、補位補進同一個座位、再開局：牌局玩家和座位表一致");
  // 不得忽略 duplicate：入座的每一種衝突都明確回錯、不寫入
  const k = await lobby(["p0", "p1"]);
  const dupPid = await post(joinRoute, { code: k.code, playerId: "p1", name: "撞名" }, "p2");
  await post(leaveRoute, { roomId: k.roomId }, "p0");                                // 房主交給 p1
  const oldHost = await post(joinRoute, { code: k.code, playerId: "p1", name: "搶房主" }, "p0");
  const back = await post(joinRoute, { code: k.code, playerId: "p0", name: "回來" }, "p0");
  for (const [pid, who] of [["p2", 2], ["p3", 3]] as const) await post(joinRoute, { code: k.code, playerId: pid, name: pid }, pid);
  const full = await post(joinRoute, { code: k.code, playerId: "p4", name: "第五人" }, "p4");
  const snK = await snap(k.roomId);
  eq([dupPid.status, dupPid.body.error, oldHost.status, oldHost.body.error, back.status, back.body.seat, full.status, full.body.error, snK.seats, snK.host, snK.hostUserOk],
    [409, "player_taken", 409, "player_taken", 200, 0, 400, "full", ["0:p0", "1:p1", "2:p2", "3:p3"], "p1", true],
    "K9 入座衝突都明確回錯、什麼都不寫：拿別人的 playerId 409 player_taken（含交接後的新房主座位）；滿 4 人 400 full；離開的原房主可以用新的座位回來");
}

// ---------- R 找回房間 ----------
{
  const m = await newMatch();
  const mine = await get(myRoomRoute, "", "p2");
  // 「斷線重進」：用找回的房號照常 join → 認回原座位、原 playerId、同一個座位頻道，讀得到自己的手牌
  const re = await post(joinRoute, { code: mine.body.room?.code, playerId: "隨便", name: "重進" }, "p2");
  const st = await state(m.roomId, "p2", re.body.playerId);
  eq([mine.status, mine.body.room, re.body.rejoined, re.body.playerId, re.body.channel === privateChannel(m.roomId, m.code, "p2", uid(2)), st.status, st.body.me?.hand?.length],
    [200, { roomId: m.roomId, code: m.code, status: "playing", seat: 2, playerId: "p2" }, true, "p2", true, 200, 16],
    "R1 斷線後重新進站：找回自己還在進行中的房（房號、座位、playerId），用房號 join 認回原座位和同一個座位頻道，讀得到自己的 16 張");

  const outsider = await get(myRoomRoute, "", "watch");
  const outJoin = await post(joinRoute, { code: m.code, playerId: "p2", name: "冒充" }, "watch");
  const outRead = await state(m.roomId, "watch", "p2");
  const guest = await get(myRoomRoute, "", "guest");
  const noLogin = await get(myRoomRoute, "");
  eq([outsider.body.room, outJoin.status, outJoin.body.error, outRead.status, outRead.body.error, guest.body.room, noLogin.status],
    [null, 400, "started", 403, "not_your_seat", null, 401],
    "R2 外人找回房間是空的（只認登入身分、不收參數）；拿別人的 playerId 也 join 不進、讀不到（403）；遊客回空、沒登入 401");

  // 房間關掉後就找不回來
  await post(leaveReqRoute, { roomId: m.roomId, playerId: "p0" }, "p0");
  for (const p of ["p1", "p2", "p3"]) await post(leaveVoteRoute, { roomId: m.roomId, playerId: p, approve: true }, p);
  const afterClose = (await get(myRoomRoute, "", "p2")).body.room;
  const stillSeated = (await db.query<{ id: string }>(`select r.id::text id from th_rooms r join th_players p on p.room_id = r.id where p.user_id = $1`, [uid(2)])).rows.map((x) => x.id);
  eq([await roomN(m.roomId), afterClose?.roomId === m.roomId, stillSeated.includes(afterClose?.roomId ?? "none")], [0, false, true],
    "R3 房間解散關掉之後，找回房間不會再回它（p2 另外還坐在 L2 那間進行中的房，回的是那間）");
}

// ---------- G 閒置清除 ----------
{
  const oldWait = await lobby(["p0", "p1"]);        // 等人 3 小時 → 清
  const freshWait = await lobby(["p0"]);            // 等人 1 小時 → 留
  const oldPlay = await newMatch();                 // 開局後打完一局、13 小時沒動 → 清並記成中途解散
  await submitAll(oldPlay.roomId, ["p0", "p1", "p2", "p3"]);
  await post(chatRoute, { roomId: oldPlay.roomId, text: "人呢" }, "p1");
  const livePlay = await newMatch();                // 開局後 11 小時沒動 → 留（還在 12 小時內）
  await ageRoom(oldWait.roomId, 3); await ageRoom(freshWait.roomId, 1); await ageRoom(oldPlay.roomId, 13); await ageRoom(livePlay.roomId, 11);
  const b = sent.length;
  const n = await sweepIdleThirteenRooms(Date.now());
  const closedEv = sent.slice(b).filter((e) => e.event === "th_room_closed" && e.channel === publicChannel(oldPlay.code));
  eq([n, await roomN(oldWait.roomId), await recOf(oldWait.roomId), await roomN(freshWait.roomId), await roomN(oldPlay.roomId), await recOf(oldPlay.roomId),
    await chatRows(oldPlay.roomId), closedEv.map((e) => e.payload.endReason), await roomN(livePlay.roomId)],
    [2, 0, null, 1, 0, { end_reason: "dissolved" }, 0, ["dissolved"], 1],
    "G1 閒置清除比照麻將：等人超過 2 小時的房刪掉（沒打過不記）、1 小時的留著；開局後超過 12 小時的房記中途解散再刪（聊天一起清、通知房裡的人），11 小時的留著");

  // 選中之後有人動了（送出三墩）→ 不清：進行中的房不會被刪
  const busy = await newMatch();
  await ageRoom(busy.roomId, 13);
  const picked = (await listIdleThirteenRooms(new Date(Date.now() - 2 * 3600_000).toISOString(), new Date(Date.now() - 12 * 3600_000).toISOString(), 10))
    .find((r) => r.id === busy.roomId)!;
  await submitAll(busy.roomId, ["p0"]);              // 選中後、關房前：玩家送出（寫入 → row_version +1）
  const res = await closeIdleRoom(picked);
  eq([!!picked, res, await roomN(busy.roomId), await recOf(busy.roomId), (await state(busy.roomId, "p1")).status],
    [true, "changed", 1, null, 200], "G2 清除選中的房在關之前有人送出：row_version 對不上就不清（回 changed），房間和牌局照常、不記紀錄");
  eq([(await state(oldWait.roomId, "p0")).status, (await get(myRoomRoute, "", "p1")).body.room?.roomId === oldWait.roomId], [404, false],
    "G3 被清掉的房：讀狀態 404，找回房間也不會再回它");
}

// ---------- P 觀戰 ----------
{
  const m = await newMatch();
  const hands: Card[][] = [];
  for (const p of ["p0", "p1", "p2", "p3"]) hands.push((await state(m.roomId, p)).body.me.hand);
  const rest = (await db.query<{ r: Card[] }>(`select game_state->'rest' r from th_rooms where id = $1`, [m.roomId])).rows[0].r;
  const allIds = [...hands.flat(), ...rest].map((c) => c.id);
  const leak = (x: unknown) => allIds.filter((id) => JSON.stringify(x).includes(`"${id}"`));

  // 還沒申請／還沒被同意：觀戰畫面、狀態、聊天紀錄都讀不到
  const early = [await get(spViewRoute, `roomId=${m.roomId}&target=p1`, "watch"), await state(m.roomId, "watch", null), await get(historyRoute, `roomId=${m.roomId}`, "watch")];
  const lookup = await get(spRoomRoute, `code=${m.code}`, "watch");
  const b = sent.length;
  const req = await post(spRequestRoute, { roomId: m.roomId, targetPlayerId: "p1" }, "watch");
  const reqEv = sent.slice(b).filter((e) => e.event === "th_spectate_request");
  const pending = [await get(spViewRoute, `roomId=${m.roomId}&target=p1`, "watch"), await state(m.roomId, "watch", null)];
  eq([early.map((r) => [r.status, r.body.error]), lookup.status, lookup.body.players.map((p: { playerId: string; status: string }) => `${p.playerId}:${p.status}`),
    req.status, req.body.status, reqEv.map((e) => [e.channel === privateChannel(m.roomId, m.code, "p1", uid(1)), e.payload.name, "spectatorId" in e.payload]),
    pending.map((r) => [r.status, r.body.error])],
    [[[403, "not_approved"], [403, "not_allowed"], [403, "not_allowed"]], 200, ["p0:available", "p1:available", "p2:available", "p3:available"],
      200, "pending", [[true, "觀戰員", false]], [[403, "not_approved"], [403, "not_allowed"]]],
    "P1 觀戰前：讀觀戰畫面、狀態、聊天紀錄都 403；用房號查到四位可申請；申請後只通知被申請的 p1（他的座位頻道，帶名字不帶帳號 id）；同意前照樣讀不到");

  // 別人不能代答：其他座位、外人、沒登入都擋下；本人同意才算
  const manage = await get(spManageRoute, `roomId=${m.roomId}&playerId=p1`, "p1");
  const requestId = manage.body.pending[0]?.requestId;
  const byOther = await post(spRespondRoute, { roomId: m.roomId, playerId: "p1", requestId, approve: true }, "p2");
  const bySelf = await post(spRespondRoute, { roomId: m.roomId, playerId: "p1", requestId, approve: true }, "watch");
  const manageOther = await get(spManageRoute, `roomId=${m.roomId}&playerId=p1`, "p0");
  const ok = await post(spRespondRoute, { roomId: m.roomId, playerId: "p1", requestId, approve: true }, "p1");
  const twice = await post(spRespondRoute, { roomId: m.roomId, playerId: "p1", requestId, approve: false }, "p1");
  eq([manage.body.pending.map((x: { name: string }) => x.name), byOther.status, bySelf.status, manageOther.status, ok.body.status, twice.status],
    [["觀戰員"], 403, 403, 403, "approved", 409], "P2 只有被申請的 p1 本人能看申請、能同意：別的座位、申請者自己代答都 403；同意後不能再改（409）");

  // 同意後：亮牌前觀戰畫面一張牌都沒有（連同意他的 p1 的手牌、已送出的三墩都沒有）；拿 p1 的 playerId 讀狀態照樣 403
  await submitAll(m.roomId, ["p1", "p2"]);
  const v = await get(spViewRoute, `roomId=${m.roomId}&target=p1`, "watch");
  const s = await state(m.roomId, "watch", null);
  const peek = await state(m.roomId, "watch", "p1");
  const otherTarget = await get(spViewRoute, `roomId=${m.roomId}&target=p0`, "watch");
  eq([v.status, v.body.phase, v.body.me, v.body.reveal, v.body.players.map((p: { submitted: boolean }) => p.submitted), leak(v.body), s.status, leak(s.body),
    peek.status, peek.body.error, otherTarget.status, v.body.target.playerId, v.body.spectatorCounts],
    [200, "arranging", null, null, [false, true, true, false], [], 200, [], 403, "not_your_seat", 403, "p1", { p0: 0, p1: 1, p2: 0, p3: 0 }],
    "P3 同意後亮牌前：觀戰畫面和狀態裡 65 張牌一張都沒有（同意他的 p1 的手牌、已送出的三墩也沒有），只看得到誰送出了；偷拿 p1 的 playerId 讀 403；沒同意的 p0 視角 403");

  // 聊天：讀得到、收得到，不能發言
  await post(chatRoute, { roomId: m.roomId, text: "加油" }, "p0");
  const hist = await get(historyRoute, `roomId=${m.roomId}`, "watch");
  const say = await post(chatRoute, { roomId: m.roomId, text: "我也要講" }, "watch");
  eq([hist.status, hist.body.role, hist.body.messages.map((x: { text: string }) => x.text), hist.body.spectatorChannel === spectatorChannelName(m.code, m.roomId, tokens["tk-watch"].id), say.status, say.body.error],
    [200, "spectator", ["加油"], true, 403, "not_in_room"], "P4 被同意的觀戰者讀得到聊天紀錄、拿到自己的觀戰頻道；發言 403 not_in_room");

  // 亮牌後才看得到四家三墩
  await submitAll(m.roomId, ["p0", "p3"]);
  const rv = await get(spViewRoute, `roomId=${m.roomId}&target=p1`, "watch");
  eq([rv.body.phase, rv.body.reveal?.arrangements?.length, leak(rv.body).length, rv.body.me], ["revealed", 4, 52, null],
    "P5 亮牌後觀戰畫面才有四家三墩（52 張發出去的牌），沒發出去的 13 張照樣沒有");

  // 自己這桌、遊客、還沒開局都不能申請；收回後立刻讀不到
  const own = await post(spRequestRoute, { roomId: m.roomId, targetPlayerId: "p0" }, "p1");
  const guest = await post(spRequestRoute, { roomId: m.roomId, targetPlayerId: "p0" }, "guest");
  const w = await lobby(["p0"]);
  const notStarted = await post(spRequestRoute, { roomId: w.roomId, targetPlayerId: "p0" }, "watch");
  const badTarget = await post(spRequestRoute, { roomId: m.roomId, targetPlayerId: "nobody" }, "watch");
  const revoke = await post(spRevokeRoute, { roomId: m.roomId, playerId: "p1" }, "p1");
  const afterRevoke = [await get(spViewRoute, `roomId=${m.roomId}&target=p1`, "watch"), await state(m.roomId, "watch", null), await get(historyRoute, `roomId=${m.roomId}`, "watch")];
  eq([own.status, own.body.error, guest.status, notStarted.status, notStarted.body.error, badTarget.body.error, revoke.body.revoked, afterRevoke.map((r) => r.status)],
    [403, "own_table", 403, 409, "not_started", "bad_target", 1, [403, 403, 403]],
    "P6 自己這桌 403 own_table、遊客 403、還沒開局 409；收回同意後觀戰畫面、狀態、聊天紀錄立刻都 403");

  // 關房：這房的觀戰資料一起刪
  const m2 = await newMatch();
  const r2 = await post(spRequestRoute, { roomId: m2.roomId, targetPlayerId: "p3" }, "watch");
  const id2 = (await get(spManageRoute, `roomId=${m2.roomId}&playerId=p3`, "p3")).body.pending[0].requestId;
  await post(spRespondRoute, { roomId: m2.roomId, playerId: "p3", requestId: id2, approve: true }, "p3");
  const before = (await loadRoomSpectate(m2.roomId)).length;
  await post(leaveReqRoute, { roomId: m2.roomId, playerId: "p0" }, "p0");
  for (const p of ["p1", "p2", "p3"]) await post(leaveVoteRoute, { roomId: m2.roomId, playerId: p, approve: true }, p);
  const gone = await get(spViewRoute, `roomId=${m2.roomId}&target=p3`, "watch");
  eq([r2.status, before, await roomN(m2.roomId), (await loadRoomSpectate(m2.roomId)).length, gone.status], [200, 1, 0, 0, 404],
    "P7 房間解散關掉：這房的觀戰申請和同意一起刪掉，觀戰畫面 404");
}

// ---------- H 我的對局紀錄 ----------
{
  // 一場打完（1 局）、一場打 1 局後解散
  const done = await newMatch(["p0", "p1", "p2", "p3"], 1);
  await submitAll(done.roomId, ["p0", "p1", "p2", "p3"]);
  NOW += 60_000;
  const diss = await newMatch(["p1", "p0", "p2", "p4"], 3);
  await submitAll(diss.roomId, ["p1", "p0", "p2", "p4"]);
  NOW += NEXT_HAND_MAX_MS; await post(tickRoute, { roomId: diss.roomId, playerId: "p1" }, "p1");
  await post(leaveReqRoute, { roomId: diss.roomId, playerId: "p1" }, "p1");
  for (const p of ["p0", "p2", "p4"]) await post(leaveVoteRoute, { roomId: diss.roomId, playerId: p, approve: true }, p);
  // 麻將場次（p0 也在）不能混進十三支紀錄
  await db.query(`with m as (insert into match_records (game, room_id, room_code, end_reason) values ('mahjong', gen_random_uuid(), '9999', 'completed') returning id)
    insert into match_record_players (match_id, seat, player_name, player_id, total_score, user_id) select id, 0, '麻將', 'mj', 999, $1::uuid from m`, [uid(0)]);
  const thRows = (await db.query<{ room_id: string; player_id: string; total_score: number }>(
    `select m.room_id::text, p.player_id, p.total_score from match_records m join match_record_players p on p.match_id = m.id where m.game = 'thirteen' and m.room_id in ($1, $2)`, [done.roomId, diss.roomId])).rows;
  const score = (room: string, pid: string) => thRows.find((r) => r.room_id === room && r.player_id === pid)!.total_score;

  const r0 = await get(recordsRoute, "", "p0");
  const items = r0.body.items as { roomCode: string; endReason: string; handsPlayed: number; totalHands: number; arrangeSec: number; myScore: number; players: { isMe: boolean; playerName: string }[] }[];
  const thirteenTotal = (await db.query<{ s: number; n: number }>(`select coalesce(sum(p.total_score),0)::int s, count(*)::int n from match_records m join match_record_players p on p.match_id = m.id where m.game = 'thirteen' and p.user_id = $1`, [uid(0)])).rows[0];
  eq([r0.status, items.slice(0, 2).map((x) => [x.roomCode, x.endReason, x.handsPlayed, x.totalHands, x.arrangeSec, x.players.length, x.players.filter((p) => p.isMe).length]),
    items[0].myScore === score(diss.roomId, "p0") && items[1].myScore === score(done.roomId, "p0"), items.some((x) => x.roomCode === "9999"),
    r0.body.summary, JSON.stringify(r0.body).includes(uid(1)), JSON.stringify(r0.body).includes("finalHand")],
    [200, [[diss.code, "dissolved", 1, 3, 30, 4, 1], [done.code, "completed", 1, 1, 30, 4, 1]], true, false, { matches: thirteenTotal.n, totalScore: thirteenTotal.s }, false, false],
    "H1 我的十三支紀錄：新到舊，打完的記 completed、中途解散記 dissolved，含局數設定、理牌秒數、我的分數和四家；麻將場次不混進來；累計＝全部十三支場次；不含帳號 id 和最後一局的牌");

  const p4 = await get(recordsRoute, "", "p4");
  const outsider = await get(recordsRoute, "", "watch");
  const noLogin = await get(recordsRoute, "");
  const page1 = await get(recordsRoute, "limit=1", "p0");
  const page2 = await get(recordsRoute, `limit=1&cursor=${encodeURIComponent(page1.body.nextCursor)}`, "p0");
  const badCursor = await get(recordsRoute, "cursor=x|y", "p0");
  eq([p4.body.items.map((x: { roomCode: string }) => x.roomCode), outsider.body.items, outsider.body.summary, noLogin.status,
    page1.body.items.map((x: { roomCode: string }) => x.roomCode), page2.body.items.map((x: { roomCode: string }) => x.roomCode), badCursor.status],
    [[diss.code], [], { matches: 0, totalScore: 0 }, 401, [diss.code], [done.code], 400],
    "H2 每個人只看得到自己有座位的場次（p4 只有那場解散的、外人一筆都沒有）；沒登入 401；分頁游標接得上；亂填游標 400");

  // 函式只給伺服器；回滾後函式不見、可以再套
  const priv = (await db.query<{ a: boolean; u: boolean; s: boolean; p: boolean }>(`select has_function_privilege('anon', 'th_my_matches(uuid,int,timestamptz,uuid)', 'execute') a,
    has_function_privilege('authenticated', 'th_my_matches(uuid,int,timestamptz,uuid)', 'execute') u,
    has_function_privilege('service_role', 'th_my_matches(uuid,int,timestamptz,uuid)', 'execute') s,
    exists (select 1 from pg_proc where proname = 'th_my_matches' and proacl::text like '%=X/%' and proacl::text not like '%service_role=X/%' and proacl::text ~ '(^|[{,])=X/') p`)).rows[0];
  const SUPA = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../supabase/migrations");
  await db.exec(readFileSync(path.join(SUPA, "20261118_thirteen_records_rollback.sql"), "utf8"));
  const afterRollback = (await db.query<{ n: number }>(`select count(*)::int n from pg_proc where proname = 'th_my_matches'`)).rows[0].n;
  const mjStill = (await db.query<{ n: number }>(`select count(*)::int n from match_records where game = 'mahjong'`)).rows[0].n;
  await db.exec(readFileSync(path.join(SUPA, "20261118_thirteen_records.sql"), "utf8"));
  const again = await get(recordsRoute, "", "p0");
  eq([priv, afterRollback, mjStill, again.body.items.length === r0.body.items.length], [{ a: false, u: false, s: true, p: false }, 0, 1, true],
    "H3 紀錄查詢函式只有伺服器（service_role）能執行，anon、authenticated、PUBLIC 都不行；回滾後函式不見、資料不動，可以再套一次");
}

// ---------- K10 入座／離開函式的權限與回滾 ----------
{
  const SUPA = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../supabase/migrations");
  const sigs = ["th_lobby_join(uuid,text,text,uuid)", "th_lobby_leave(uuid,uuid)"];
  const priv = [];
  for (const f of sigs) priv.push((await db.query<{ a: boolean; u: boolean; s: boolean }>(`select has_function_privilege('anon', '${f}', 'execute') a,
    has_function_privilege('authenticated', '${f}', 'execute') u, has_function_privilege('service_role', '${f}', 'execute') s`)).rows[0]);
  const rooms = (await db.query<{ n: number }>(`select count(*)::int n from th_players`)).rows[0].n;
  await db.exec(readFileSync(path.join(SUPA, "20261118_thirteen_lobby_rollback.sql"), "utf8"));
  const gone = (await db.query<{ n: number }>(`select count(*)::int n from pg_proc where proname in ('th_lobby_join', 'th_lobby_leave')`)).rows[0].n;
  const roomsAfter = (await db.query<{ n: number }>(`select count(*)::int n from th_players`)).rows[0].n;
  await db.exec(readFileSync(path.join(SUPA, "20261118_thirteen_lobby.sql"), "utf8"));
  const m = await lobby(["p0", "p1"]);
  eq([priv, gone, roomsAfter === rooms, await seatsOf(m.roomId)], [[{ a: false, u: false, s: true }, { a: false, u: false, s: true }], 0, true, ["p0", "p1"]],
    "K10 入座／離開函式只有伺服器（service_role）能執行；回滾後兩個函式不見、座位資料不動，可以再套一次並照常入座");
}

console.log(results.join("\n"));
if (results.some((r) => r.startsWith("❌"))) process.exit(1);
