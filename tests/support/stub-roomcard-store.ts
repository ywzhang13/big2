// 測試用：lib/roomCard/store.ts 的記憶體版本（老柯 2026-11-20）。
// 在 PGlite（記憶體 PostgreSQL）跑真的 20261120_room_cards.sql，呼叫真的 SQL 函式，時間用 clock.now 控制。
// 模擬的部分：Supabase 的角色和 auth.users（遊客 app_metadata.guest = true、LINE 名稱在 user_metadata）；
// 麻將、十三支的房間和座位只建房卡查詢用得到的欄位（正在打哪一房）。
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SUPABASE_SETUP } from "./pg-mj";
import type { CardGame } from "../../lib/roomCard/rules";
import type { Account, AdjustResult, AuditRow, FeedCursor, FeedKind, FeedRow, LedgerRow, LineUser, PlayerRow, SuspendResult } from "../../lib/roomCard/store";

export const clock = { now: Date.parse("2026-11-20T04:00:00Z") };
export const nowMs = () => clock.now;
const at = () => new Date(clock.now).toISOString();
/** true：扣卡丟錯（測扣卡失敗不影響牌局；暫停檢查等其他查詢照常） */
export const failing = { on: false };

let dbp: Promise<PGlite> | null = null;
export function db(): Promise<PGlite> {
  dbp ??= (async () => {
    const d = new PGlite();
    await d.exec(SUPABASE_SETUP);
    await d.exec(`alter table auth.users add column raw_user_meta_data jsonb not null default '{}';
      create table public.mj_rooms (id uuid primary key, code text, status text);
      create table public.mj_players (room_id uuid, user_id uuid);
      create table public.th_rooms (id uuid primary key, code text, status text);
      create table public.th_players (room_id uuid, user_id uuid);`);
    for (const f of ["20261120_room_cards.sql", "20261120_room_cards_ledger_all.sql"])
      await d.exec(readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../supabase/migrations", f), "utf8"));
    return d;
  })();
  return dbp;
}

/** 測試用：建一個帳號（guest=true 是遊客） */
export async function addUser(id: string, name: string, guest = false): Promise<void> {
  await (await db()).query("insert into auth.users (id, raw_app_meta_data, raw_user_meta_data) values ($1, $2, $3) on conflict do nothing",
    [id, guest ? { guest: true } : { provider: "custom:line" }, { name, picture: `https://example.com/${name}.png` }]);
}

export async function chargeHand(game: CardGame, roomId: string, roomCode: string, handNo: number, userIds: string[]): Promise<number> {
  if (failing.on) throw new Error("模擬資料庫錯誤");
  const r = await (await db()).query<{ n: number }>("select public.room_card_charge($1, $2, $3, $4, $5::uuid[], $6) as n", [game, roomId, roomCode, handNo, userIds, at()]);
  return Number(r.rows[0].n);
}
export async function accounts(userIds: string[]): Promise<Map<string, Account>> {
  const out = new Map<string, Account>();
  if (userIds.length === 0) return out;
  const r = await (await db()).query<{ user_id: string; balance: number; suspended_at: Date | null }>(
    "select user_id, balance, suspended_at from room_card_accounts where user_id = any($1::uuid[])", [userIds]);
  for (const x of r.rows) out.set(x.user_id, { balance: Number(x.balance), suspendedAt: x.suspended_at ? x.suspended_at.getTime() : null });
  return out;
}
export async function topup(actor: string, userId: string, cards: number, opId: string): Promise<AdjustResult> {
  return (await (await db()).query<{ r: AdjustResult }>("select public.room_card_topup($1, $2, $3, $4, $5) as r", [actor, userId, cards, opId, at()])).rows[0].r;
}
export async function reclaim(actor: string, userId: string, cards: number, opId: string): Promise<AdjustResult> {
  return (await (await db()).query<{ r: AdjustResult }>("select public.room_card_reclaim($1, $2, $3, $4, $5) as r", [actor, userId, cards, opId, at()])).rows[0].r;
}
export async function setSuspended(actor: string, userId: string, suspend: boolean, opId: string): Promise<SuspendResult> {
  const r = (await (await db()).query<{ r: { ok: boolean; suspendedAt?: string | null; replay?: boolean } }>("select public.room_card_set_suspended($1, $2, $3, $4, $5) as r",
    [actor, userId, suspend, opId, at()])).rows[0].r;
  return r.ok ? { ok: true, suspendedAt: r.suspendedAt ? Date.parse(r.suspendedAt) : null, replay: !!r.replay } : { ok: false, error: "op_conflict" };
}
export async function playerRows(): Promise<PlayerRow[]> {
  const r = await (await db()).query<{ user_id: string; balance: number; suspended_at: Date | null; last_topup_at: Date | null; last_charge_at: Date | null; playing_game: CardGame | null; playing_code: string | null }>("select * from public.room_card_players()");
  const t = (d: Date | null) => (d ? d.getTime() : null);
  return r.rows.map((x) => ({ userId: x.user_id, balance: Number(x.balance), suspendedAt: t(x.suspended_at), lastTopupAt: t(x.last_topup_at), lastChargeAt: t(x.last_charge_at),
    playing: x.playing_game && x.playing_code ? { game: x.playing_game, code: x.playing_code } : null }));
}
export async function chargedSince(since: number): Promise<number> {
  return Number((await (await db()).query<{ n: number }>("select public.room_card_charged_since($1) as n", [new Date(since).toISOString()])).rows[0].n);
}
export async function history(userId: string, limit: number): Promise<{ ledger: LedgerRow[]; audit: AuditRow[] }> {
  const d = await db();
  const l = await d.query<{ id: number; created_at: Date; kind: LedgerRow["kind"]; delta: number; balance_after: number; game: CardGame | null; room_id: string | null; room_code: string | null; hand_no: number | null; actor: string }>(
    "select * from room_card_ledger where user_id = $1 order by id desc limit $2", [userId, limit]);
  const a = await d.query<{ id: number; created_at: Date; action: AuditRow["action"]; actor: string }>("select * from room_card_audit where user_id = $1 order by id desc limit $2", [userId, limit]);
  return {
    ledger: l.rows.map((r) => ({ id: Number(r.id), at: r.created_at.getTime(), kind: r.kind, delta: Number(r.delta), balanceAfter: Number(r.balance_after), game: r.game, roomId: r.room_id, roomCode: r.room_code, handNo: r.hand_no, actor: r.actor })),
    audit: a.rows.map((r) => ({ id: Number(r.id), at: r.created_at.getTime(), action: r.action, actor: r.actor })),
  };
}
const toLine = (r: { id: string; raw_app_meta_data: Record<string, unknown>; raw_user_meta_data: Record<string, unknown> }): LineUser | null =>
  r.raw_app_meta_data?.guest === true ? null : { userId: r.id, name: String(r.raw_user_meta_data?.name ?? "LINE 使用者"), avatarUrl: (r.raw_user_meta_data?.picture as string) ?? null };
export async function lineUsers(): Promise<LineUser[]> {
  const r = await (await db()).query<{ id: string; raw_app_meta_data: Record<string, unknown>; raw_user_meta_data: Record<string, unknown> }>("select * from auth.users order by id");
  return r.rows.map(toLine).filter((x): x is LineUser => !!x);
}
export async function lineUser(userId: string): Promise<LineUser | null> {
  const r = await (await db()).query<{ id: string; raw_app_meta_data: Record<string, unknown>; raw_user_meta_data: Record<string, unknown> }>("select * from auth.users where id = $1", [userId]);
  return r.rows[0] ? toLine(r.rows[0]) : null;
}

export async function ledgerAll(o: { kind: FeedKind | null; since: number | null; limit: number; cursor: FeedCursor | null; skip: string }): Promise<{ entries: FeedRow[]; stats: { topup: number; charge: number; reclaim: number } }> {
  const r = await (await db()).query<{ r: { entries: FeedRow[]; stats: { topup: number; charge: number; reclaim: number } } }>(
    "select public.room_card_ledger_all($1, $2, $3, $4, $5, $6, $7) as r",
    [o.kind, o.since === null ? null : new Date(o.since).toISOString(), o.limit, o.cursor?.at ?? null, o.cursor?.src ?? null, o.cursor?.id ?? null, o.skip]);
  return r.rows[0].r;
}
