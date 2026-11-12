// 測試用：lib/mahjong/replay/store.ts 的記憶體版本。
// 在 PGlite（記憶體 PostgreSQL）跑真的 20261113_mahjong_replay.sql，呼叫同一批 SQL 函式；時間用 stub-donate-store 的 clock.now。
// 對戰紀錄表（match_records、match_record_players）沿用 stub-zimofx-store 建好的同一個資料庫。
import type { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { ReplayRecord, ReplaySummary } from "../../lib/mahjong/replay/log";
import type { ReplayMatch } from "../../lib/mahjong/replay/store";
import { clock, db as baseDb } from "./stub-zimofx-store";

const at = () => new Date(clock.now).toISOString();
const iso = (v: unknown) => new Date(v as string).toISOString();
export const replayFail = { save: false }; // true：寫入丟錯（測失敗不影響牌局存檔）
export const saveCalls: { roomId: string; handNo: number }[] = [];

let dbp: Promise<PGlite> | null = null;
export function db(): Promise<PGlite> {
  dbp ??= (async () => {
    const d = await baseDb();
    const sql = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../supabase/migrations/20261113_mahjong_replay.sql");
    await d.exec(readFileSync(sql, "utf8"));
    return d;
  })();
  return dbp;
}

export async function saveReplay(roomId: string, handNo: number, summary: ReplaySummary, data: ReplayRecord): Promise<number> {
  saveCalls.push({ roomId, handNo });
  if (replayFail.save) throw new Error("模擬資料庫錯誤");
  const r = await (await db()).query<{ n: number }>("select public.mj_replay_save($1, $2, $3, $4, $5) as n", [roomId, handNo, summary, data, at()]);
  return Number(r.rows[0].n);
}

export async function findReplayMatch(matchId: string, userId: string): Promise<ReplayMatch | null> {
  const r = (await (await db()).query<Record<string, unknown>>("select * from public.mj_replay_match($1, $2, $3)", [matchId, userId, at()])).rows[0];
  if (!r) return null;
  return {
    roomId: String(r.room_id), roomCode: String(r.room_code), endedAt: iso(r.ended_at), expiresAt: iso(r.expires_at),
    mySeat: r.my_seat == null ? null : Number(r.my_seat), expired: !!r.expired,
    players: (r.players as { seat: number; name: string }[]) ?? [],
  };
}

export async function listReplayHands(roomId: string) {
  const r = await (await db()).query<{ hand_no: number; summary: ReplaySummary; recorded_at: unknown }>("select * from public.mj_replay_hands($1)", [roomId]);
  return r.rows.map((x) => ({ handNo: Number(x.hand_no), summary: x.summary, recordedAt: iso(x.recorded_at) }));
}

export async function loadReplayHand(roomId: string, handNo: number): Promise<ReplayRecord | null> {
  const r = await (await db()).query<{ d: ReplayRecord | null }>("select public.mj_replay_hand($1, $2) as d", [roomId, handNo]);
  return r.rows[0]?.d ?? null;
}
