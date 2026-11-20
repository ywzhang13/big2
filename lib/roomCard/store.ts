// 房卡的資料庫存取（只在伺服器用 service role）。函式在 supabase/migrations/20261120_room_cards.sql。
// 測試時整個檔案會被換成 tests/support/stub-roomcard-store.ts（在記憶體 PostgreSQL 跑真的 migration 和 SQL 函式）。
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import type { CardGame } from "./rules";

/** 伺服器現在時間（測試換成可控制的時鐘） */
export const nowMs = () => Date.now();

async function rpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await getSupabaseAdmin().rpc(fn, args);
  if (error) throw new Error(`${fn} 失敗：${error.message}`);
  return data as T;
}
const ms = (v: string | null | undefined) => (v ? Date.parse(v) : null);

/** 這一把每個人各扣 1 張（已經扣過、遊客跳過），回傳這次真的扣了幾個人 */
export async function chargeHand(game: CardGame, roomId: string, roomCode: string, handNo: number, userIds: string[]): Promise<number> {
  return Number(await rpc<number>("room_card_charge", { p_game: game, p_room_id: roomId, p_room_code: roomCode, p_hand_no: handNo, p_users: userIds }));
}

export interface Account { balance: number; suspendedAt: number | null }
/** 這些帳號的餘額和暫停狀態（沒有帳戶的人不在回傳裡＝餘額 0、沒暫停） */
export async function accounts(userIds: string[]): Promise<Map<string, Account>> {
  const out = new Map<string, Account>();
  if (userIds.length === 0) return out;
  const { data, error } = await getSupabaseAdmin().from("room_card_accounts").select("user_id, balance, suspended_at").in("user_id", userIds);
  if (error) throw new Error(`讀取房卡帳戶失敗：${error.message}`);
  for (const r of data ?? []) out.set(String(r.user_id), { balance: Number(r.balance), suspendedAt: ms(r.suspended_at) });
  return out;
}

export type AdjustResult = { ok: true; balance: number; replay: boolean } | { ok: false; error: "op_conflict" };
export async function topup(actor: string, userId: string, cards: number, opId: string): Promise<AdjustResult> {
  return rpc<AdjustResult>("room_card_topup", { p_actor: actor, p_user: userId, p_cards: cards, p_op: opId });
}
export async function reclaim(actor: string, userId: string, cards: number, opId: string): Promise<AdjustResult> {
  return rpc<AdjustResult>("room_card_reclaim", { p_actor: actor, p_user: userId, p_cards: cards, p_op: opId });
}
export type SuspendResult = { ok: true; suspendedAt: number | null; replay: boolean } | { ok: false; error: "op_conflict" };
export async function setSuspended(actor: string, userId: string, suspend: boolean, opId: string): Promise<SuspendResult> {
  const r = await rpc<{ ok: boolean; error?: "op_conflict"; suspendedAt?: string | null; replay?: boolean }>("room_card_set_suspended",
    { p_actor: actor, p_user: userId, p_suspend: suspend, p_op: opId });
  return r.ok ? { ok: true, suspendedAt: ms(r.suspendedAt), replay: !!r.replay } : { ok: false, error: "op_conflict" };
}

export interface PlayerRow { userId: string; balance: number; suspendedAt: number | null; lastTopupAt: number | null; lastChargeAt: number | null; playing: { game: CardGame; code: string } | null }
/** 每個有房卡帳戶的人（扣過、充過、暫停過） */
export async function playerRows(): Promise<PlayerRow[]> {
  const rows = await rpc<{ user_id: string; balance: number; suspended_at: string | null; last_topup_at: string | null; last_charge_at: string | null; playing_game: CardGame | null; playing_code: string | null }[]>("room_card_players", {});
  return (rows ?? []).map((r) => ({ userId: String(r.user_id), balance: Number(r.balance), suspendedAt: ms(r.suspended_at), lastTopupAt: ms(r.last_topup_at),
    lastChargeAt: ms(r.last_charge_at), playing: r.playing_game && r.playing_code ? { game: r.playing_game, code: r.playing_code } : null }));
}
/** since 之後扣了幾張 */
export async function chargedSince(since: number): Promise<number> {
  return Number(await rpc<number>("room_card_charged_since", { p_since: new Date(since).toISOString() }));
}

export interface LedgerRow { id: number; at: number; kind: "topup" | "charge" | "reclaim"; delta: number; balanceAfter: number; game: CardGame | null; roomId: string | null; roomCode: string | null; handNo: number | null; actor: string }
export interface AuditRow { id: number; at: number; action: "suspend" | "resume"; actor: string }
/** 一個人的流水帳和暫停紀錄（新的在前，各最多 limit 筆） */
export async function history(userId: string, limit: number): Promise<{ ledger: LedgerRow[]; audit: AuditRow[] }> {
  const sb = getSupabaseAdmin();
  const [l, a] = await Promise.all([
    sb.from("room_card_ledger").select("id, created_at, kind, delta, balance_after, game, room_id, room_code, hand_no, actor").eq("user_id", userId).order("id", { ascending: false }).limit(limit),
    sb.from("room_card_audit").select("id, created_at, action, actor").eq("user_id", userId).order("id", { ascending: false }).limit(limit),
  ]);
  if (l.error) throw new Error(`讀取房卡流水帳失敗：${l.error.message}`);
  if (a.error) throw new Error(`讀取暫停紀錄失敗：${a.error.message}`);
  return {
    ledger: (l.data ?? []).map((r) => ({ id: Number(r.id), at: Date.parse(r.created_at), kind: r.kind, delta: Number(r.delta), balanceAfter: Number(r.balance_after),
      game: r.game ?? null, roomId: r.room_id ?? null, roomCode: r.room_code ?? null, handNo: r.hand_no ?? null, actor: String(r.actor) })),
    audit: (a.data ?? []).map((r) => ({ id: Number(r.id), at: Date.parse(r.created_at), action: r.action, actor: String(r.actor) })),
  };
}

export interface LineUser { userId: string; name: string; avatarUrl: string | null }
function toLineUser(u: { id: string; app_metadata?: unknown; user_metadata?: unknown }): LineUser | null {
  if ((u.app_metadata as Record<string, unknown> | undefined)?.guest === true) return null;
  const m = (u.user_metadata ?? {}) as Record<string, unknown>;
  const name = [m.name, m.full_name, m.nickname].find((v): v is string => typeof v === "string" && !!v);
  const pic = [m.picture, m.avatar_url].find((v): v is string => typeof v === "string" && v.startsWith("https://"));
  return { userId: u.id, name: name ?? "LINE 使用者", avatarUrl: pic ?? null };
}
/** 所有 LINE 登入帳號（不含遊客）。人數少，直接列全部（同斗內後台的找玩家） */
export async function lineUsers(): Promise<LineUser[]> {
  const out: LineUser[] = [];
  for (let page = 1; page <= 10; page++) {
    const { data, error } = await getSupabaseAdmin().auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw new Error(`讀取玩家資料失敗：${error.message}`);
    for (const u of data.users) { const x = toLineUser(u); if (x) out.push(x); }
    if (data.users.length < 1000) break;
  }
  return out;
}
/** 一個 LINE 帳號（不是 LINE 帳號、是遊客、不存在回 null） */
export async function lineUser(userId: string): Promise<LineUser | null> {
  const { data, error } = await getSupabaseAdmin().auth.admin.getUserById(userId);
  if (error || !data.user) return null;
  return toLineUser(data.user);
}
