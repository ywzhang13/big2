// 測試用：lib/mahjong/zimoFx/store.ts 的記憶體版本。
// 在 PGlite（記憶體 PostgreSQL）跑真的 20261031_mahjong_zimo_fx.sql，呼叫真的 SQL 函式，時間用 clock.now 控制。
// 和 stub-donate-store 共用同一個資料庫和時鐘（正式庫也是同一個）：老闆記帳會把 mj_donate_acks 的歸零點設成現在，斗內卡次數照真的一起變。
// LINE 帳號（搜尋、名稱頭像）用 users 這份假資料。
import type { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { AuditRecord, Deduction, DonationRecord, GrantRecord, ZimoCountRow } from "../../lib/mahjong/zimoFx/store";

import { clock, db as donateDb } from "./stub-donate-store";
export { clock };
export const nowMs = () => clock.now;
const iso = (ms: number) => new Date(ms).toISOString();
const ms = (v: unknown) => (v ? new Date(v as string).getTime() : null);
export const users: Record<string, { name: string; avatarUrl: string | null; guest?: boolean }> = {};
export const fail = { zimoFxFor: false }; // true：zimoFxFor 丟錯（測查不到時老闆照樣有隕石、其他人回一般浮層）

let dbp: Promise<PGlite> | null = null;
export function db(): Promise<PGlite> {
  dbp ??= (async () => {
    const d = await donateDb(); // 已經建好角色、auth.users 和 20261021 的斗內表
    const migrations = ["20261031_mahjong_zimo_fx.sql", "20261101_mahjong_golden_zimo.sql", "20261102_mahjong_donate_deduct.sql"];
    for (const migration of migrations) {
      const sql = path.resolve(path.dirname(fileURLToPath(import.meta.url)), `../../supabase/migrations/${migration}`);
      await d.exec(readFileSync(sql, "utf8"));
    }
    return d;
  })();
  return dbp;
}
async function one<T>(sql: string, args: unknown[]): Promise<T> { return (await (await db()).query<{ r: T }>(sql, args)).rows[0].r; }

export const order: string[] = []; // 測試看呼叫順序（審伯 2026-10-31 必修 1：要在登入檢查之前就發出查詢）
export async function zimoFxFor(userIds: string[]): Promise<Map<string, { fx: string; until: number | null }>> {
  order.push("fx");
  if (fail.zimoFxFor) throw new Error("模擬資料庫錯誤");
  const r = await (await db()).query<{ user_id: string; fx: string; until: unknown }>("select * from mj_zimo_fx_for($1, $2)", [userIds, iso(clock.now)]);
  order.push("fx-done");
  return new Map(r.rows.map((x) => [x.user_id, { fx: x.fx, until: ms(x.until) }]));
}
export async function addDonation(actor: string, d: { userId: string; name: string; avatarUrl: string | null; amount: number; donatedAt: number; note: string }): Promise<{ id: string; deduction: Deduction }> {
  const r = await one<{ id: string } & Deduction>("select mj_donation_record($1, $2, $3, $4, $5, $6, $7, $8) as r", [actor, d.userId, d.name, d.avatarUrl, d.amount, iso(d.donatedAt), d.note, iso(clock.now)]);
  return { id: String(r.id), deduction: { before: r.before, deducted: r.deducted, remaining: r.remaining, tip: r.tip, price: r.price } };
}
export async function clearZimo(actor: string, userId: string): Promise<number> {
  return Number(await one("select mj_zimo_clear($1, $2, $3) as r", [actor, userId, iso(clock.now)])) || 0;
}
export async function zimoCounts(): Promise<ZimoCountRow[]> {
  const r = await (await db()).query<Record<string, unknown>>("select * from mj_zimo_counts()");
  return r.rows.map((x) => ({ userId: String(x.user_id), count: Number(x.count) || 0, lastResetAt: ms(x.last_reset_at),
    lastResetSource: x.last_reset_source === "donation" || x.last_reset_source === "clear" ? x.last_reset_source : null, lastResetCleared: (x.last_reset_cleared as number | null) ?? null }));
}
export async function lineProfiles(userIds: string[]) {
  return new Map(userIds.filter((id) => users[id] && !users[id].guest).map((id) => [id, { name: users[id].name, avatarUrl: users[id].avatarUrl }]));
}
export async function voidDonation(actor: string, id: string, reason: string): Promise<boolean> {
  return (await one<boolean>("select mj_donation_void($1, $2, $3, $4) as r", [actor, id, reason, iso(clock.now)])) === true;
}
export async function listDonations(range?: { from: number; to: number }): Promise<DonationRecord[]> {
  const r = await (await db()).query<Record<string, unknown>>(
    `select * from mj_donations ${range ? "where donated_at >= $1 and donated_at < $2" : ""} order by donated_at desc`, range ? [iso(range.from), iso(range.to)] : []);
  return r.rows.map((x) => ({
    id: String(x.id), userId: String(x.user_id), name: String(x.player_name), avatarUrl: (x.player_avatar as string) ?? null, amount: Number(x.amount),
    donatedAt: ms(x.donated_at)!, note: String(x.note ?? ""), createdAt: ms(x.created_at)!, voided: !!x.voided_at, voidedAt: ms(x.voided_at), voidReason: (x.void_reason as string) ?? null,
  }));
}
export async function grantFx(actor: string, userId: string, fx: string[], active: string, expiresAt: number): Promise<number> {
  return Number(await one("select mj_fx_grant($1, $2, $3, $4, $5, $6) as r", [actor, userId, fx, active, iso(expiresAt), iso(clock.now)]));
}
export async function revokeFx(actor: string, userId: string, fx: string[] | null): Promise<number> {
  return Number(await one("select mj_fx_revoke($1, $2, $3, $4) as r", [actor, userId, fx, iso(clock.now)]));
}
export async function selectFx(userId: string, fx: string, permanent: boolean): Promise<boolean> {
  return (await one<boolean>("select mj_fx_select($1, $2, $3, $4) as r", [userId, fx, permanent, iso(clock.now)])) === true;
}
export async function playerFx(userId: string): Promise<{ grants: GrantRecord[]; selected: string | null }> {
  const d = await db();
  const g = await d.query<Record<string, unknown>>("select * from mj_fx_grants where user_id = $1 order by granted_at desc", [userId]);
  const p = await d.query<{ fx: string }>("select fx from mj_fx_prefs where user_id = $1", [userId]);
  return { grants: g.rows.map((x) => ({ id: String(x.id), fx: String(x.fx), grantedAt: ms(x.granted_at)!, expiresAt: ms(x.expires_at)!, revokedAt: ms(x.revoked_at) })), selected: p.rows[0]?.fx ?? null };
}
export async function listAudit(limit: number): Promise<AuditRecord[]> {
  const r = await (await db()).query<Record<string, unknown>>("select * from mj_fx_audit order by id desc limit $1", [limit]);
  return r.rows.map((x) => ({ id: Number(x.id), at: ms(x.at)!, actorId: String(x.actor_id), action: String(x.action), targetUserId: String(x.target_user_id), recordId: (x.record_id as string) ?? null, detail: (x.detail as Record<string, unknown>) ?? {} }));
}
export async function searchUsers(q: string) {
  return Object.entries(users).filter(([, u]) => !u.guest && u.name.toLowerCase().includes(q.toLowerCase())).map(([userId, u]) => ({ userId, name: u.name, avatarUrl: u.avatarUrl }));
}
export async function lineProfile(userId: string) {
  const u = users[userId];
  return u && !u.guest ? { name: u.name, avatarUrl: u.avatarUrl } : null;
}
