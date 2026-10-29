// 測試用：lib/mahjong/spectate/store.ts 的記憶體版本。
// 在 PGlite（記憶體 PostgreSQL）跑真的 20261030_mahjong_spectate.sql，呼叫真的 SQL 函式，時間用 clock.now 控制。
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SPECTATE_KEEP_MS, SPECTATE_WINDOW_MS, toRequestResult, type RequestResult, type SpectateRow } from "../../lib/mahjong/spectate/rules";

export const clock = { now: Date.parse("2026-10-30T00:00:00Z") };
export const nowMs = () => clock.now;
const iso = () => new Date(clock.now).toISOString();

let dbp: Promise<PGlite> | null = null;
export function db(): Promise<PGlite> {
  dbp ??= (async () => {
    const d = new PGlite();
    await d.exec("create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;");
    const sql = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../supabase/migrations/20261030_mahjong_spectate.sql");
    await d.exec(readFileSync(sql, "utf8"));
    return d;
  })();
  return dbp;
}

export async function requestSpectate(roomId: string, spectatorId: string, targetPlayerId: string, name: string, avatarUrl: string | null): Promise<RequestResult> {
  const r = await (await db()).query<{ r: unknown }>("select public.mj_spectate_request($1, $2, $3, $4, $5, $6, $7) as r",
    [roomId, spectatorId, targetPlayerId, name, avatarUrl, SPECTATE_WINDOW_MS, iso()]);
  return toRequestResult(r.rows[0].r);
}

export async function respondSpectate(roomId: string, targetPlayerId: string, requestId: string, approve: boolean): Promise<boolean> {
  const r = await (await db()).query<{ r: boolean }>("select public.mj_spectate_respond($1, $2, $3, $4, $5, $6) as r",
    [roomId, targetPlayerId, requestId, approve, SPECTATE_WINDOW_MS, iso()]);
  return r.rows[0].r === true;
}

export async function revokeSpectate(roomId: string, targetPlayerId: string, requestId: string | null): Promise<number> {
  const r = await (await db()).query<{ r: number }>("select public.mj_spectate_revoke($1, $2, $3, $4) as r", [roomId, targetPlayerId, requestId, iso()]);
  return Number(r.rows[0].r) || 0;
}

export async function loadRoomSpectate(roomId: string): Promise<SpectateRow[]> {
  const r = await (await db()).query<Record<string, string | null>>(
    "select spectator_id, target_player_id, request_id, status, spectator_name, spectator_avatar, requested_at from mj_spectate where room_id = $1", [roomId]);
  return r.rows.map((x) => ({
    spectatorId: String(x.spectator_id), targetPlayerId: String(x.target_player_id), requestId: String(x.request_id),
    status: x.status as SpectateRow["status"], name: String(x.spectator_name), avatarUrl: x.spectator_avatar ?? null,
    requestedAt: new Date(x.requested_at as unknown as string).getTime(),
  }));
}

export async function deleteRoomSpectate(roomId: string): Promise<void> {
  await (await db()).query("delete from mj_spectate where room_id = $1", [roomId]);
}

export const failNext = { deleteOld: false }; // true：下一次 deleteOldSpectate 丟錯（測「失敗只記錄、不影響關房」）
export async function deleteOldSpectate(): Promise<void> {
  if (failNext.deleteOld) { failNext.deleteOld = false; throw new Error("模擬資料庫錯誤"); }
  await (await db()).query("delete from mj_spectate where requested_at < $1", [new Date(clock.now - SPECTATE_KEEP_MS).toISOString()]);
}
