// 斗內以場結清（老闆 2026-11-02；20261104_mahjong_match_settle.sql），走真的 migration（PGlite）和真的 API
//   M1 套用 migration：11/1 之後用舊的記一筆抵扣過的帳（含之後作廢的），補上結清列、連到原本那筆斗內（不多記斗內）；欠款＝11/1 後未結清場次的自摸，套用前後不變
//   S1 剛好給：結清一場，記一筆斗內＝應給、打賞 0；欠款、斗內榜跟著變；看過次數往下調，卡片不會自己跳出來
//   S1' 結清用的那筆斗內不能從通用作廢 API 作廢（409，什麼都不改）
//   S2 少給：拒絕（409 short，回傳還差多少），什麼都不寫
//   S3 多給：多的算打賞，和應給記成同一筆斗內；斗內榜照實收計入
//   S4 一次結清多場：應給是合計，打賞只記一次（同一筆斗內、一筆操作紀錄）
//   S5 還在打的場次：斗內卡照樣算進去，但不能結清（409 not_finished），後台列在 playing
//   S6 已經結清的再結清（already_settled）、11/1 以前的場次（nothing_due）都拒絕
//   S7 撤回：同一批的場次全部回到未結清，那筆斗內（含打賞）整筆作廢，斗內榜扣回；寫 match_unsettle；再撤回 404
//   S8 後台清單、一個人的場次；對戰紀錄每場每人自摸次數、每一把、我的應給和結清狀態
//   S9 一般玩家呼叫結清／撤回 403；記一筆只記打賞，不結清任何場次；特效開通一次開 6 種、不改玩家的選擇
//   S10 回滾：新函式拿掉、欠款和特效函式改回舊版；結清、斗內、操作紀錄一筆都沒少；再套用一次會被擋下（表已經在）
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { GET as donateGet } from "../../app/api/mahjong/donate/route";
import { POST as donateSeen } from "../../app/api/mahjong/donate/seen/route";
import { GET as settleGet, POST as settlePost } from "../../app/api/mahjong/admin/settlements/route";
import { POST as revokePost } from "../../app/api/mahjong/admin/settlements/revoke/route";
import { POST as tipPost } from "../../app/api/mahjong/admin/donations/route";
import { POST as voidPost } from "../../app/api/mahjong/admin/donations/void/route";
import { POST as fxGrant } from "../../app/api/mahjong/admin/fx/route";
import { GET as boardGet } from "../../app/api/mahjong/donations/leaderboard/route";
import { GET as recordsGet } from "../../app/api/mahjong/records/route";
import { tokens } from "../support/stub-auth";
import { addUser } from "../support/stub-donate-store";
import { records } from "../support/stub-records-store";
import { legacyDonationsAdd } from "../support/legacy-donation";
import { addMatch, clock, db, extraMigrations, users } from "../support/stub-zimofx-store";
extraMigrations.length = 0; // 先在舊的資料庫建好 11/1 之後的舊帳，再自己套用 20261104（測轉換）

const MIG = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../supabase/migrations");
const BOSS = "c5707922-f6f0-4c10-9c87-3532fdbf6b72";
const uid = (n: number) => `ea000000-0000-4000-8000-00000000000${n}`;
const rid = (n: number) => `eb000000-0000-4000-8000-00000000000${n}`;
const [A, B, C] = [1, 2, 3].map(uid);
tokens.boss = { id: BOSS, displayName: "張育瑋", pictureUrl: null, isGuest: false };
tokens.a = { id: A, displayName: "阿明", pictureUrl: null, isGuest: false };
users[BOSS] = { name: "張育瑋", avatarUrl: null };
users[A] = { name: "阿明", avatarUrl: null }; users[B] = { name: "阿華", avatarUrl: null }; users[C] = { name: "小美", avatarUrl: null };
for (const u of [BOSS, A, B, C]) await addUser(u);

const results: string[] = [];
function eq(a: unknown, e: unknown, msg: string) {
  const ok = JSON.stringify(a) === JSON.stringify(e);
  results.push(`${ok ? "✅" : "❌"} ${msg}\n   預期=${JSON.stringify(e)} 實際=${JSON.stringify(a)}`);
}
const T = (s: string) => Date.parse(s + "+08:00");
const auth = (tok?: string): Record<string, string> => (tok ? { authorization: `Bearer ${tok}` } : {});
const call = async (fn: (r: Request) => Promise<Response>, url: string, body?: object, tok = "boss") => {
  const r = await fn(new Request("http://x" + url, body ? { method: "POST", headers: { "content-type": "application/json", ...auth(tok) }, body: JSON.stringify(body) } : { headers: auth(tok) }));
  return { status: r.status, body: await r.json() };
};
const d = await db();
const n = async (sql: string, args: unknown[] = []) => Number((await d.query<{ n: number }>(sql, args)).rows[0].n);
const card = async () => (await call(donateGet, "/", undefined, "a")).body as { count: number; show: boolean };
const board = async () => (await call(boardGet, "/?range=all")).body.rows.map((r: { name: string; amount: number }) => [r.name, r.amount]);
const counts = async () => [await n("select count(*)::int n from mj_donations"), await n("select count(*)::int n from mj_fx_audit"),
  (await n("select (to_regclass('public.mj_match_settlements') is not null)::int n")) ? await n("select count(*)::int n from mj_match_settlements") : 0];
let hand = 0;
const win = (room: string, u: string, at: string) => d.query("insert into mj_zimo_wins (room_id, hand_no, user_id, won_at) values ($1, $2, $3, $4)", [room, ++hand, u, new Date(T(at)).toISOString()]);
// 一場：資料庫的 match_records（結清用）＋對戰紀錄 API 的紀錄（座位 0＝A、1＝B、2＝C、3＝遊客）
async function match(room: string, code: string, start: string, end: string | null) {
  await addMatch(room, code, T(start), end ? T(end) : null);
  if (end) records.push({ game: "mahjong", roomId: room, roomCode: code, startedAt: new Date(T(start)).toISOString(), endedAt: new Date(T(end)).toISOString(), endReason: "completed",
    totalRounds: 1, basePoints: 100, fanPoints: 20, settings: {}, handsPlayed: 8,
    players: [[A, "阿明"], [B, "阿華"], [C, "小美"], [null, "遊客"]].map(([u, name], seat) => ({ seat, playerName: name as string, playerId: "p" + seat, userId: u, totalScore: 0 })) });
}

// ---- 舊帳（套用前）：R0 10/30（11/1 以前）、R1 1426、R2 5881；B 11/1 23:30 用舊的記一筆斗 NT$10（抵 R1 那 1 次）----
await match(rid(0), "1111", "2026-10-30T20:00:00", "2026-10-30T23:00:00");
await win(rid(0), A, "2026-10-30T21:00:00"); await win(rid(0), A, "2026-10-30T22:00:00");
await match(rid(1), "1426", "2026-11-01T18:00:00", "2026-11-01T20:00:00");
await win(rid(1), A, "2026-11-01T19:00:00"); await win(rid(1), A, "2026-11-01T19:30:00"); await win(rid(1), B, "2026-11-01T19:40:00");
await match(rid(2), "5881", "2026-11-01T21:00:00", "2026-11-01T23:00:00");
await win(rid(2), A, "2026-11-01T22:00:00");
clock.now = T("2026-11-01T23:30:00");
const legacy = await (await legacyDonationsAdd(new Request("http://x", { method: "POST", body: JSON.stringify({ userId: B, amount: 10, donatedAt: new Date(clock.now).toISOString() }) }))).json();
// C：R6 自摸 1 次，23:40 用舊的記一筆斗 NT$10（抵 1），之後那筆被作廢（舊制度作廢不還原次數 → C 還是 0）
await match(rid(6), "6060", "2026-11-01T21:30:00", "2026-11-01T23:00:00");
await win(rid(6), C, "2026-11-01T22:30:00");
clock.now = T("2026-11-01T23:40:00");
const legacyC = await (await legacyDonationsAdd(new Request("http://x", { method: "POST", body: JSON.stringify({ userId: C, amount: 10, donatedAt: new Date(clock.now).toISOString() }) }))).json();
await d.query("select mj_donation_void($1, $2, '測試作廢', $3)", [BOSS, legacyC.id, new Date(T("2026-11-01T23:50:00")).toISOString()]);
const cntOld = async (u: string) => n("select public.mj_donate_count($1) n", [u]);
const cBefore = await cntOld(C);
const validSum = async () => n("select coalesce(sum(amount), 0)::int n from mj_donations where voided_at is null");
const sumBefore = await validSum();
const before = await counts();

// ---- M1 套用 ----
clock.now = T("2026-11-02T10:00:00");
await d.exec(readFileSync(path.join(MIG, "20261104_mahjong_match_settle.sql"), "utf8"));
const mig = (await d.query<{ room_id: string; user_id: string; zimo_count: number; donation_id: string; source: string }>("select room_id, user_id, zimo_count, donation_id, source from mj_match_settlements order by user_id")).rows;
const after = await counts();
const cnt = async (u: string) => n("select public.mj_donate_count($1) n", [u]);
eq([legacy.deduction.deducted, mig.map((r) => [r.room_id, r.user_id, r.zimo_count, r.donation_id === legacy.id || r.donation_id === legacyC.id, r.source]), after[0] - before[0], after[1] - before[1], await cnt(A), await cnt(B)],
  [1, [[rid(1), B, 1, true, "migrate"], [rid(6), C, 1, true, "migrate"]], 0, 2, 3, 0],
  "M1 套用：B、C 用舊的記一筆抵掉的 R1、R6 各補一筆結清（連到原本那筆斗內，不多記斗內、各多 1 筆操作紀錄）；A 欠 3 次（R1 2＋R2 1，10/30 的 R0 不算）、B 0");
eq([legacyC.deduction.deducted, cBefore, await cnt(C), await validSum() === sumBefore],
  [1, 0, 0, true],
  "M1 舊抵扣後又作廢（審伯必修 2）：C 的 NT$10 抵了 1 次後被作廢，舊制度 C 是 0；套用後照樣 0（R6 算已結清），有效斗內金額不變");

// ---- S1 剛好給 ----
await call(donateSeen, "/", { count: 3 }, "a"); // A 收起卡片（看過 3）
const s1 = await call(settlePost, "/", { userId: A, roomIds: [rid(1)] });
const seen1 = await n("select seen_count n from mj_donate_acks where user_id = $1", [A]);
eq([s1.status, s1.body.due, s1.body.amount, s1.body.tip, s1.body.rooms.map((r: { roomCode: string; zimo: number }) => [r.roomCode, r.zimo]), await card(), seen1, await board()],
  [200, 20, 20, 0, [["1426", 2]], { count: 1, show: false }, 1, [["阿明", 20], ["阿華", 10]]],
  "S1 結清 R1（沒送金額＝剛好給 NT$20）：打賞 0；A 卡片 1 次、看過次數降到 1 → 已收起的卡片不會自己跳出來；斗內榜阿明 20");

// ---- S1' 通用作廢擋下結清用的斗內（審伯必修 1）----
const c1v = await counts();
const v1 = await call(voidPost, "/", { id: s1.body.batchId, reason: "想直接作廢" });
const don1 = (await d.query<{ voided_at: unknown }>("select voided_at from mj_donations where id = $1", [s1.body.batchId])).rows[0];
const active1 = await n("select count(*)::int n from mj_match_settlements where donation_id = $1 and revoked_at is null", [s1.body.batchId]);
eq([v1.status, v1.body.error, don1.voided_at, active1, (await card()).count, (await counts()).join() === c1v.join(), (await board())[0]],
  [409, "not_voidable", null, 1, 1, true, ["阿明", 20]],
  "S1' 結清用的那筆斗內從通用作廢 409：斗內沒作廢、結清列還在、A 還是 1 次、斗內／操作紀錄／結清筆數都沒變、斗內榜不變（只能用撤回整批）");

// ---- S2 少給 ----
const c2 = await counts();
const s2 = await call(settlePost, "/", { userId: A, roomIds: [rid(2)], amount: 5 });
eq([s2.status, s2.body, (await counts()).join() === c2.join(), (await card()).count], [409, { error: "short", due: 10, amount: 5, shortBy: 5 }, true, 1],
  "S2 R2 應給 NT$10 只給 5：409 short、還差 5；斗內、操作紀錄、結清都沒寫，A 還是 1 次");

// ---- S3 多給 ----
const s3 = await call(settlePost, "/", { userId: A, roomIds: [rid(2)], amount: 50 });
const don3 = (await d.query<{ amount: number; note: string }>("select amount, note from mj_donations where id = $1", [s3.body.batchId])).rows[0];
eq([s3.status, s3.body.due, s3.body.amount, s3.body.tip, don3, (await card()).count, await board()],
  [200, 10, 50, 40, { amount: 50, note: "結清 房 5881" }, 0, [["阿明", 70], ["阿華", 10]]],
  "S3 R2 給 NT$50：應給 10、打賞 40，記成同一筆 NT$50 斗內（備註結清 房 5881）；A 0 次；斗內榜阿明 20＋50＝70");

// ---- S4 一次結清多場 ----
await match(rid(3), "3029", "2026-11-02T12:00:00", "2026-11-02T14:00:00");
await win(rid(3), A, "2026-11-02T12:30:00"); await win(rid(3), A, "2026-11-02T13:00:00");
await match(rid(4), "7416", "2026-11-02T15:00:00", "2026-11-02T17:00:00");
await win(rid(4), A, "2026-11-02T16:00:00");
clock.now = T("2026-11-02T18:00:00");
const c4 = await counts();
const s4 = await call(settlePost, "/", { userId: A, roomIds: [rid(4), rid(3)], amount: 100 });
const c4b = await counts();
eq([s4.status, s4.body.due, s4.body.tip, s4.body.rooms.map((r: { roomCode: string; due: number }) => [r.roomCode, r.due]), c4b[0] - c4[0], c4b[1] - c4[1], c4b[2] - c4[2], (await board())[0]],
  [200, 30, 70, [["3029", 20], ["7416", 10]], 1, 1, 2, ["阿明", 170]],
  "S4 一次結清 R3（2 次）＋R4（1 次）給 NT$100：應給合計 30、打賞 70 只記一次 → 1 筆斗內、1 筆操作紀錄、2 筆結清；斗內榜 170");

// ---- S5 還在打的場次 ----
await win(rid(5), A, "2026-11-02T19:00:00"); // R5 還沒有對戰紀錄＝還在打
clock.now = T("2026-11-02T19:10:00");
const c5 = await counts();
const s5 = await call(settlePost, "/", { userId: A, roomIds: [rid(5)] });
const mine5 = (await call(settleGet, `/?userId=${A}`)).body;
eq([await card(), s5.status, s5.body, (await counts()).join() === c5.join(), mine5.unpaid.length, mine5.playing.map((m: { roomId: string; zimo: number }) => [m.roomId, m.zimo])],
  [{ count: 1, show: true }, 409, { error: "not_finished", roomId: rid(5) }, true, 0, [[rid(5), 1]]],
  "S5 還在打的 R5 自摸 1 次：斗內卡照樣算進去（1 次、出現）；結清 409 not_finished、什麼都沒寫；後台列在 playing，不在 unpaid");

// ---- S6 已結清、11/1 以前 ----
const s6a = await call(settlePost, "/", { userId: A, roomIds: [rid(1)] });
const s6b = await call(settlePost, "/", { userId: A, roomIds: [rid(0)] });
const s6c = await call(settlePost, "/", { userId: A, roomIds: [rid(3), rid(2)] });
eq([[s6a.status, s6a.body.error], [s6b.status, s6b.body.error], [s6c.status, s6c.body.error], (await counts()).join() === c5.join()],
  [[409, "already_settled"], [409, "nothing_due"], [409, "already_settled"], true],
  "S6 R1 已結清再結清 409 already_settled；10/30 的 R0（11/1 以前）409 nothing_due；混一場已結清的整批拒絕；都沒寫任何東西");

// ---- S7 撤回 ----
const s7 = await call(revokePost, "/", { batchId: s4.body.batchId, reason: "按錯" });
const don7 = (await d.query<{ voided_at: unknown; void_reason: string }>("select voided_at, void_reason from mj_donations where id = $1", [s4.body.batchId])).rows[0];
const aud7 = (await d.query<{ action: string; detail: { amount: number; rooms: unknown[] } }>("select action, detail from mj_fx_audit order by id desc limit 1")).rows[0];
const s7b = await call(revokePost, "/", { batchId: s4.body.batchId });
eq([s7.status, s7.body.amount, s7.body.rooms.length, !!don7.voided_at, don7.void_reason, await card(), (await board())[0], [aud7.action, aud7.detail.amount, aud7.detail.rooms.length], s7b.status],
  [200, 100, 2, true, "撤回結清：按錯", { count: 4, show: true }, ["阿明", 70], ["match_unsettle", 100, 2], 404],
  "S7 撤回 S4 那批：R3、R4 都回到未結清，NT$100（含打賞 70）整筆作廢；A 卡片 4 次（1＋3）、看過不動 → 出現；斗內榜回到 70；寫 match_unsettle；再撤回 404");

// ---- S8 後台清單、一個人的場次、對戰紀錄 ----
const list = (await call(settleGet, "/")).body;
const mine = (await call(settleGet, `/?userId=${A}`)).body;
const recs = (await call(recordsGet, "/?limit=10", undefined, "a")).body.items;
const rec = (code: string) => { const r = recs.find((x: { roomCode: string }) => x.roomCode === code); return [r.zimo, r.zimoHands.length, r.myDue, "roomId" in r || "seatUserIds" in r]; };
eq([list.total, list.players.map((p: { name: string; matches: number; zimo: number; amount: number }) => [p.name, p.matches, p.zimo, p.amount]),
  mine.unpaid.map((m: { roomCode: string; due: number }) => [m.roomCode, m.due]), mine.totalDue, mine.paid.map((p: { roomCode: string; amount: number; tip: number }) => [p.roomCode, p.amount, p.tip])],
  [30, [["阿明", 2, 3, 30]], [["3029", 20], ["7416", 10]], 30, [["5881", 50, 40], ["1426", 20, 0]]],
  "S8 後台：只有阿明未結清（2 場 3 次 NT$30；還在打的 R5 不算）；他的場次 R3、R4 未結清，最近結清的 R2（實收 50、打賞 40）、R1（20）");
eq([rec("1426"), rec("3029"), rec("1111")],
  [[[{ seat: 0, count: 2 }, { seat: 1, count: 1 }], 3, { zimo: 2, due: 20, settled: true }, false],
   [[{ seat: 0, count: 2 }], 2, { zimo: 2, due: 20, settled: false }, false],
   [[{ seat: 0, count: 2 }], 2, null, false]],
  "S8 對戰紀錄：R1 阿明（座位 0）自摸 2、阿華 1，每一把都列出，我的應給 20 已結清；R3 撤回後未結清；10/30 的 R0 照樣顯示自摸 2 但沒有應給；不回房間 id、座位帳號");

// ---- S9 權限、打賞、特效 ----
const deny = [(await call(settlePost, "/", { userId: A, roomIds: [rid(3)] }, "a")).status, (await call(revokePost, "/", { batchId: s3.body.batchId }, "a")).status, (await call(settleGet, "/", undefined, "a")).status];
const c9 = await counts();
const tip = await call(tipPost, "/", { userId: A, amount: 200, donatedAt: new Date(clock.now).toISOString() });
const c9b = await counts();
await d.query("insert into mj_fx_prefs (user_id, fx, updated_at) values ($1, 'golden', now())", [C]);
const g = await call(fxGrant, "/", { userId: C });
const fxRows = await n("select count(*)::int n from mj_fx_grants where user_id = $1 and revoked_at is null", [C]);
const pref = (await d.query<{ fx: string }>("select fx from mj_fx_prefs where user_id = $1", [C])).rows[0].fx;
eq([deny, [tip.status, tip.body.tip], c9b[0] - c9[0], c9b[2] - c9[2], (await card()).count, [g.status, g.body.granted, fxRows, pref]],
  [[403, 403, 403], [200, 200], 1, 0, 4, [200, 6, 6, "golden"]],
  "S9 阿明呼叫結清、撤回、清單都 403；記一筆 NT$200 只記打賞（多 1 筆斗內、0 筆結清），A 還是 4 次；開通小美一次 6 種，沒指定套用就不改她原本的金色自摸");

// ---- S10 回滾 ----
const c10 = await counts();
await d.exec(readFileSync(path.join(MIG, "20261104_mahjong_match_settle_rollback.sql"), "utf8"));
const gone = await n("select count(*)::int n from pg_proc where proname in ('mj_match_settle', 'mj_match_unsettle', 'mj_match_unsettled', 'mj_match_settled', 'mj_donation_tip', 'mj_match_zimo')");
const oldCount = await n("select public.mj_donate_count($1) n", [A]); // 舊算法：歸零點（A 沒有歸零列，看過時才建的、歸零點 -infinity）之後的全部自摸
const allWins = await n("select count(*)::int n from mj_zimo_wins where user_id = $1", [A]);
let again = "沒擋";
try { await d.exec(readFileSync(path.join(MIG, "20261104_mahjong_match_settle.sql"), "utf8")); } catch { again = "擋下"; await d.exec("rollback"); } // 被 raise 擋下時交易還開著，收掉
eq([gone, (await counts()).join() === c10.join(), oldCount === allWins, again], [0, true, true, "擋下"],
  "S10 回滾：6 個新函式都拿掉；結清、斗內、操作紀錄筆數不變；欠款改回舊算法（歸零點之後的全部自摸）；再套用一次被擋下");

console.log(results.join("\n"));
if (results.some((r) => r.startsWith("❌"))) process.exit(1);
