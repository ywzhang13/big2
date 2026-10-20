// 測試用：lib/mahjong/effects/store.ts 的記憶體版本。
// 在 PGlite（記憶體 PostgreSQL）跑真的 20261021_mahjong_effects.sql，呼叫真的 mj_effect_take，時間用 clock.now 控制。
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { EFFECT_GROUP, GROUP_COOLDOWN_MS, GROUP_PROTECT_MS, toResult, type EffectKind, type TakeResult } from "../../lib/mahjong/effects/rules";

export const clock = { now: Date.parse("2026-10-21T00:00:00Z") };
export const calls = { deleteRoomEffects: [] as string[] };

let dbp: Promise<PGlite> | null = null;
export function db(): Promise<PGlite> {
  dbp ??= (async () => {
    const d = new PGlite();
    await d.exec("create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;");
    const sql = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../supabase/migrations/20261021_mahjong_effects.sql");
    await d.exec(readFileSync(sql, "utf8"));
    return d;
  })();
  return dbp;
}

export async function takeEffect(roomId: string, senderId: string, targetId: string, kind: EffectKind): Promise<TakeResult> {
  const g = EFFECT_GROUP[kind];
  const res = await (await db()).query<{ r: unknown }>("select public.mj_effect_take($1, $2, $3, $4, $5, $6, $7) as r", [
    roomId, senderId, targetId, g, GROUP_COOLDOWN_MS[g], GROUP_PROTECT_MS[g], new Date(clock.now).toISOString(),
  ]);
  return toResult(res.rows[0].r);
}

export async function deleteRoomEffects(roomId: string): Promise<void> {
  calls.deleteRoomEffects.push(roomId);
  await (await db()).query("delete from mj_effect_rate where room_id = $1", [roomId]);
}
