// 自摸次數 11/1 起從 0 開始（老闆 2026-11-01；20261103_mahjong_donate_reset_1101.sql），走真的 migration（PGlite）和真的 API
//   R1 重置前先完整備份 mj_donate_acks（每一列、每個欄位都一樣）
//   R2 重置後每人次數＝11/1 00:00（台灣時間）之後的自摸數；還欠的、看過都歸 0；斗內卡 count 0、不顯示
//   R3 mj_zimo_wins、mj_donations、mj_fx_audit 的筆數不變（操作紀錄只多 1 筆 zimo_reset_all，記人數和清掉的總次數）
//   R4 後台清單：歸零方式是 system（系統重置）、清掉幾次＝重置前的次數；應斗＝次數 × 10
//   R5 重置後再自摸：次數從 1 開始、斗內卡出現；記一筆的自動抵扣只扣 11/1 之後的
//   R6 再套用一次不會再重置、也不會多寫紀錄；回滾檔把 mj_donate_acks 還原成備份（重置時新增的列刪掉）
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { GET as donateGet } from "../../app/api/mahjong/donate/route";
import { POST as donationsAdd } from "../../app/api/mahjong/admin/donations/route";
import { GET as countsGet } from "../../app/api/mahjong/admin/zimo-counts/route";
import { GET as audit } from "../../app/api/mahjong/admin/audit/route";
import { tokens } from "../support/stub-auth";
import { addUser } from "../support/stub-donate-store";
import { clock, db, users } from "../support/stub-zimofx-store";

const MIG = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../supabase/migrations");
const BOSS = "c5707922-f6f0-4c10-9c87-3532fdbf6b72";
const id = (n: number) => `ee000000-0000-4000-8000-00000000000${n}`;
const [A, B, C, D] = [1, 2, 3, 4].map(id);
tokens.boss = { id: BOSS, displayName: "張育瑋", pictureUrl: null, isGuest: false };
tokens.a = { id: A, displayName: "阿明", pictureUrl: null, isGuest: false };
users[BOSS] = { name: "張育瑋", avatarUrl: null };
["阿明", "阿華", "小美", "阿強"].forEach((n, i) => (users[id(i + 1)] = { name: n, avatarUrl: null }));
for (const u of [BOSS, A, B, C, D]) await addUser(u);

const results: string[] = [];
function eq(a: unknown, e: unknown, msg: string) {
  const ok = JSON.stringify(a) === JSON.stringify(e);
  results.push(`${ok ? "✅" : "❌"} ${msg}\n   預期=${JSON.stringify(e)} 實際=${JSON.stringify(a)}`);
}
const T = (s: string) => Date.parse(s + "+08:00");
const auth = (tok?: string): Record<string, string> => (tok ? { authorization: `Bearer ${tok}` } : {});
const get = async (fn: (r: Request) => Promise<Response>, url: string, tok?: string) => (await fn(new Request("http://x" + url, { headers: auth(tok) }))).json();
const post = async (fn: (r: Request) => Promise<Response>, body: object, tok?: string) =>
  (await fn(new Request("http://x", { method: "POST", headers: { "content-type": "application/json", ...auth(tok) }, body: JSON.stringify(body) }))).json();
const d = await db();
let room = 0;
const win = (u: string, at: string) => d.query("insert into mj_zimo_wins (room_id, hand_no, user_id, won_at) values ($1, 1, $2, $3)", [`ef000000-0000-4000-8000-${String(++room).padStart(12, "0")}`, u, new Date(T(at)).toISOString()]);
const n = async (sql: string) => Number((await d.query<{ n: number }>(sql)).rows[0].n);
const count = async (u: string) => Number((await d.query<{ n: number }>("select public.mj_donate_count($1) n", [u])).rows[0].n);
const acksRows = async (t = "mj_donate_acks") => JSON.stringify((await d.query(`select user_id, acked_at, carried, seen_count, reset_source, reset_cleared from ${t} order by user_id`)).rows);

// ---- 重置前的狀態（10 月）：A 自摸 8 次、記過一筆抵扣後還欠 3；B 自摸 5 次、看過 5；C 自摸 2 次；D 沒自摸過 ----
clock.now = T("2026-10-20T12:00:00");
for (let i = 0; i < 8; i++) await win(A, "2026-10-15T20:00:00");
clock.now = T("2026-10-25T12:00:00");
await post(donationsAdd, { userId: A, amount: 50, donatedAt: new Date(clock.now).toISOString() }, "boss"); // 8 → 抵 5、剩 3
for (let i = 0; i < 5; i++) await win(B, "2026-10-26T20:00:00");
await d.query("select * from mj_donate_seen($1, 5)", [B]);
for (let i = 0; i < 2; i++) await win(C, "2026-10-31T23:59:59"); // 11/1 前最後一秒
const before = { A: await count(A), B: await count(B), C: await count(C), D: await count(D) };
const beforeAcks = await acksRows();
const cnt0 = { wins: await n("select count(*)::int n from mj_zimo_wins"), donations: await n("select count(*)::int n from mj_donations"), audit: await n("select count(*)::int n from mj_fx_audit") };

// ---- 套用重置 ----
clock.now = T("2026-11-01T03:00:00");
await d.exec(readFileSync(path.join(MIG, "20261103_mahjong_donate_reset_1101.sql"), "utf8"));
const backup = await acksRows("mj_donate_acks_backup_20261101");
eq([before, backup === beforeAcks], [{ A: 3, B: 5, C: 2, D: 0 }, true], "R1 重置前：A 還欠 3、B 5（看過 5）、C 2、D 0；備份表和重置前的 mj_donate_acks 每列每欄都一樣");

const after = { A: await count(A), B: await count(B), C: await count(C), D: await count(D) };
const st = (await d.query<{ user_id: string; carried: number; seen_count: number; reset_source: string; reset_cleared: number; acked_at: Date }>("select * from mj_donate_acks order by user_id")).rows;
const card = await get(donateGet, "/", "a");
eq([after, st.every((r) => r.carried === 0 && r.seen_count === 0 && r.reset_source === "system" && new Date(r.acked_at).getTime() === T("2026-11-01T00:00:00")), st.length, card],
  [{ A: 0, B: 0, C: 0, D: 0 }, true, 3, { count: 0, show: false }],
  "R2 重置後每人都是 0（11/1 之後還沒有自摸）；A、B、C 三人的還欠、看過歸 0、歸零點＝11/1 00:00、方式 system；斗內卡 count 0、不顯示");

const cnt1 = { wins: await n("select count(*)::int n from mj_zimo_wins"), donations: await n("select count(*)::int n from mj_donations"), audit: await n("select count(*)::int n from mj_fx_audit") };
const rec = (await d.query<{ actor_id: string; target_user_id: string; detail: { users: number; cleared: number } }>("select actor_id, target_user_id, detail from mj_fx_audit where action = 'zimo_reset_all'")).rows;
eq([cnt1.wins === cnt0.wins, cnt1.donations === cnt0.donations, cnt1.audit - cnt0.audit, rec.map((r) => [r.actor_id, r.target_user_id, r.detail.users, r.detail.cleared])],
  [true, true, 1, [["system", "all", 3, 10]]], "R3 自摸紀錄、斗內紀錄筆數不變；操作紀錄只多 1 筆 zimo_reset_all（system、all、3 人、共清掉 3＋5＋2＝10 次）");

const list = await get(countsGet, "/", "boss");
const row = (name: string) => { const p = list.players.find((x: { name: string }) => x.name === name); return p && [p.count, p.owed, p.lastResetSource, p.lastResetCleared, p.lastResetAt === T("2026-11-01T00:00:00")]; };
const auditList = (await get(audit, "/?limit=5", "boss")).records.map((r: { action: string }) => r.action);
eq([row("阿明"), row("阿華"), row("小美"), auditList[0]], [[0, 0, "system", 3, true], [0, 0, "system", 5, true], [0, 0, "system", 2, true], "zimo_reset_all"],
  "R4 後台清單：每人 0 次、應斗 0、歸零方式 system、清掉幾次＝重置前的次數、時間 11/1 00:00；操作紀錄最新一筆是 zimo_reset_all");

// ---- 重置後再自摸、記帳 ----
clock.now = T("2026-11-01T20:00:00");
await win(A, "2026-11-01T19:00:00"); await win(A, "2026-11-01T19:30:00"); await win(B, "2026-11-01T19:40:00");
const a1 = await count(A), cardA = await get(donateGet, "/", "a");
const ded = (await post(donationsAdd, { userId: A, amount: 100, donatedAt: new Date(clock.now).toISOString() }, "boss")).deduction;
eq([a1, cardA, await count(B), [ded.before, ded.deducted, ded.remaining, ded.tip], await count(A)], [2, { count: 2, show: true }, 1, [2, 2, 0, 80], 0],
  "R5 11/1 晚上 A 自摸 2 次 → 斗內卡 2 次出現；B 1 次；記一筆 NT$100 只抵 11/1 之後的 2 次（10 月的不算）、打賞 80、歸 0");

// ---- 重跑、回滾 ----
const audit2 = await n("select count(*)::int n from mj_fx_audit");
const acks2 = await acksRows();
await d.exec(readFileSync(path.join(MIG, "20261103_mahjong_donate_reset_1101.sql"), "utf8"));
const same = (await acksRows()) === acks2 && (await n("select count(*)::int n from mj_fx_audit")) === audit2;
await d.exec(readFileSync(path.join(MIG, "20261103_mahjong_donate_reset_1101_rollback.sql"), "utf8"));
const restored = (await acksRows()) === beforeAcks;
eq([same, restored, await count(C)], [true, true, 2], "R6 再套用一次什麼都不變、不多寫紀錄；回滾後 mj_donate_acks 和重置前完全一樣（重置時新增的列刪掉），C 回到 2 次");

console.log(results.join("\n"));
if (results.some((r) => r.startsWith("❌"))) process.exit(1);
