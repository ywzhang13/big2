// 自摸特效庫＋斗內的資料庫存取（只在伺服器用 service role）。
// 測試時整個檔案會被換成 tests/support/stub-zimofx-store.ts（在記憶體 PostgreSQL 跑真的 migration 和 SQL 函式）。
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import type { DonationRow } from "./rules";

/** 伺服器現在時間（測試換成可控制的時鐘） */
export const nowMs = () => Date.now();
const iso = (ms: number) => new Date(ms).toISOString();
const ms = (v: string | null) => (v ? Date.parse(v) : null);

async function rpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await getSupabaseAdmin().rpc(fn, args);
  if (error) throw new Error(`${fn} 失敗：${error.message}`);
  return data as T;
}

/** 胡牌時：這幾個帳號目前選用的特效，和那一種的有效到期時間（沒有有效開通＝null） */
export async function zimoFxFor(userIds: string[]): Promise<Map<string, { fx: string; until: number | null }>> {
  if (userIds.length === 0) return new Map();
  const rows = await rpc<{ user_id: string; fx: string; until: string | null }[]>("mj_zimo_fx_for", { p_users: userIds });
  return new Map((rows ?? []).map((r) => [r.user_id, { fx: r.fx, until: ms(r.until) }]));
}

/** 記一筆斗內；同一個交易裡把這位玩家的斗內卡自摸次數歸零（mj_donate_acks） */
export async function addDonation(actor: string, d: { userId: string; name: string; avatarUrl: string | null; amount: number; donatedAt: number; note: string }): Promise<string> {
  return rpc<string>("mj_donation_add", {
    p_actor: actor, p_user: d.userId, p_name: d.name, p_avatar: d.avatarUrl, p_amount: d.amount, p_donated_at: iso(d.donatedAt), p_note: d.note,
  });
}
export async function voidDonation(actor: string, id: string, reason: string): Promise<boolean> {
  return (await rpc<boolean>("mj_donation_void", { p_actor: actor, p_id: id, p_reason: reason })) === true;
}

export interface DonationRecord extends DonationRow { id: string; note: string; createdAt: number; voidedAt: number | null; voidReason: string | null }
/** 斗內紀錄（含作廢的），donated_at 在 [from, to) 之間；不給就是全部。新的在前。
 *  分頁讀完（每頁 1000）：總斗內要加總全部，不能被筆數上限截掉 */
export async function listDonations(range?: { from: number; to: number }): Promise<DonationRecord[]> {
  type Row = { id: string; user_id: string; player_name: string; player_avatar: string | null; amount: number; donated_at: string; note: string | null; created_at: string; voided_at: string | null; void_reason: string | null };
  const data: Row[] = [];
  for (let page = 0; ; page++) {
    let q = getSupabaseAdmin().from("mj_donations")
      .select("id, user_id, player_name, player_avatar, amount, donated_at, note, created_at, voided_at, void_reason")
      .order("donated_at", { ascending: false }).order("id").range(page * 1000, page * 1000 + 999);
    if (range) q = q.gte("donated_at", iso(range.from)).lt("donated_at", iso(range.to));
    const { data: rows, error } = await q;
    if (error) throw new Error(`讀取斗內紀錄失敗：${error.message}`);
    data.push(...((rows ?? []) as Row[]));
    if (!rows || rows.length < 1000) break;
  }
  return data.map((r) => ({
    id: String(r.id), userId: String(r.user_id), name: String(r.player_name), avatarUrl: r.player_avatar ?? null, amount: Number(r.amount),
    donatedAt: Date.parse(r.donated_at), note: String(r.note ?? ""), createdAt: Date.parse(r.created_at),
    voided: !!r.voided_at, voidedAt: ms(r.voided_at), voidReason: r.void_reason ?? null,
  }));
}

export async function grantFx(actor: string, userId: string, fx: string[], active: string, expiresAt: number): Promise<number> {
  return Number(await rpc<number>("mj_fx_grant", { p_actor: actor, p_user: userId, p_fx: fx, p_active: active, p_expires: iso(expiresAt) }));
}
export async function revokeFx(actor: string, userId: string, fx: string[] | null): Promise<number> {
  return Number(await rpc<number>("mj_fx_revoke", { p_actor: actor, p_user: userId, p_fx: fx }));
}
export async function selectFx(userId: string, fx: string, permanent: boolean): Promise<boolean> {
  return (await rpc<boolean>("mj_fx_select", { p_user: userId, p_fx: fx, p_permanent: permanent })) === true;
}

export interface GrantRecord { id: string; fx: string; grantedAt: number; expiresAt: number; revokedAt: number | null }
/** 一個帳號的所有開通紀錄（新的在前）和目前選用 */
export async function playerFx(userId: string): Promise<{ grants: GrantRecord[]; selected: string | null }> {
  const sb = getSupabaseAdmin();
  const [g, p] = await Promise.all([
    sb.from("mj_fx_grants").select("id, fx, granted_at, expires_at, revoked_at").eq("user_id", userId).order("granted_at", { ascending: false }).limit(500),
    sb.from("mj_fx_prefs").select("fx").eq("user_id", userId).maybeSingle(),
  ]);
  if (g.error || p.error) throw new Error(`讀取特效開通失敗：${(g.error ?? p.error)!.message}`);
  return {
    grants: (g.data ?? []).map((r) => ({ id: String(r.id), fx: String(r.fx), grantedAt: Date.parse(r.granted_at), expiresAt: Date.parse(r.expires_at), revokedAt: ms(r.revoked_at) })),
    selected: p.data?.fx ?? null,
  };
}

export interface AuditRecord { id: number; at: number; actorId: string; action: string; targetUserId: string; recordId: string | null; detail: Record<string, unknown> }
export async function listAudit(limit: number): Promise<AuditRecord[]> {
  const { data, error } = await getSupabaseAdmin().from("mj_fx_audit").select("id, at, actor_id, action, target_user_id, record_id, detail").order("id", { ascending: false }).limit(limit);
  if (error) throw new Error(`讀取操作紀錄失敗：${error.message}`);
  return (data ?? []).map((r) => ({ id: Number(r.id), at: Date.parse(r.at), actorId: String(r.actor_id), action: String(r.action), targetUserId: String(r.target_user_id), recordId: r.record_id ?? null, detail: r.detail ?? {} }));
}

/** 後台找玩家：LINE 登入帳號（不含遊客），名稱包含 q。人數少，直接列全部帳號比對 */
export async function searchUsers(q: string): Promise<{ userId: string; name: string; avatarUrl: string | null }[]> {
  const out: { userId: string; name: string; avatarUrl: string | null }[] = [];
  const needle = q.toLowerCase();
  for (let page = 1; page <= 10; page++) {
    const { data, error } = await getSupabaseAdmin().auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw new Error(`搜尋玩家失敗：${error.message}`);
    for (const u of data.users) {
      if ((u.app_metadata as Record<string, unknown>)?.guest === true) continue;
      const m = (u.user_metadata ?? {}) as Record<string, unknown>;
      const name = [m.name, m.full_name, m.nickname].find((v): v is string => typeof v === "string" && !!v);
      if (!name || !name.toLowerCase().includes(needle)) continue;
      const pic = [m.picture, m.avatar_url].find((v): v is string => typeof v === "string" && v.startsWith("https://"));
      out.push({ userId: u.id, name, avatarUrl: pic ?? null });
    }
    if (data.users.length < 1000) break;
  }
  return out.slice(0, 50);
}
/** 一個帳號目前的 LINE 名稱和頭像（記帳時存一份到斗內紀錄；不是 LINE 帳號或是遊客回 null） */
export async function lineProfile(userId: string): Promise<{ name: string; avatarUrl: string | null } | null> {
  const { data, error } = await getSupabaseAdmin().auth.admin.getUserById(userId);
  if (error || !data.user || (data.user.app_metadata as Record<string, unknown>)?.guest === true) return null;
  const m = (data.user.user_metadata ?? {}) as Record<string, unknown>;
  const name = [m.name, m.full_name, m.nickname].find((v): v is string => typeof v === "string" && !!v);
  const pic = [m.picture, m.avatar_url].find((v): v is string => typeof v === "string" && v.startsWith("https://"));
  return { name: name ?? "LINE 使用者", avatarUrl: pic ?? null };
}
