// 解散投票判斷用：這房每個帳號最後一次聊天、丟互動的時間（從既有的冷卻紀錄讀，不另外寫）。
// 測試時整個檔案會被換成 tests/support/stub-leave-store.ts。
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { invalidateGameState } from "@/lib/mahjong/cache";
import type { MatchRecordInput } from "@/lib/records/types";

/** userId → 最後一次聊天或丟互動的時間（毫秒）。查不到不擋投票，只是不算這兩種操作 */
export async function socialActivityByUser(roomId: string): Promise<Record<string, number>> {
  const db = getSupabaseAdmin();
  const [chat, fx] = await Promise.all([
    db.from("mj_chat_rate").select("user_id, last_at").eq("room_id", roomId),
    db.from("mj_effect_rate").select("subject_id, slot, last_at").eq("room_id", roomId).in("slot", ["send_light", "send_heavy"]),
  ]);
  if (chat.error) throw new Error(`讀取聊天時間失敗：${chat.error.message}`);
  if (fx.error) throw new Error(`讀取互動時間失敗：${fx.error.message}`);
  const out: Record<string, number> = {};
  const put = (u: string, t: string) => { const ms = Date.parse(t); if (ms > (out[u] ?? 0)) out[u] = ms; };
  for (const r of (chat.data ?? []) as { user_id: string; last_at: string }[]) put(r.user_id, r.last_at);
  for (const r of (fx.data ?? []) as { subject_id: string; last_at: string }[]) put(r.subject_id, r.last_at);
  return out;
}

export type DissolveResult = "closed" | "activity" | "changed" | "not_found" | "already_closed";

/**
 * 解散：在同一個資料庫交易裡「排他鎖住房間 → 確認被當成閒置的人在 cutoff 之後沒有聊天／互動 → 寫紀錄＋刪房」
 * （mj_leave_dissolve，20261114_mahjong_idle_vote.sql）。
 *   activity＝有人剛聊天或互動，不能排除他，什麼都沒改；changed＝牌局版本變了（有人剛動作），什麼都沒改
 * p_record 的欄位和 lib/records/store.ts closeRoom 一樣（close_room_with_record 的格式）。
 */
export async function dissolveRoom(
  roomId: string, rec: MatchRecordInput | null, expectedVersion: number | undefined, idleUserIds: string[], cutoffMs: number,
): Promise<DissolveResult> {
  const { data, error } = await getSupabaseAdmin().rpc("mj_leave_dissolve", {
    p_room: roomId,
    p_record: rec
      ? {
          room_code: rec.roomCode, started_at: rec.startedAt, end_reason: rec.endReason, total_rounds: rec.totalRounds,
          base_points: rec.basePoints, fan_points: rec.fanPoints, settings: rec.settings, hands_played: rec.handsPlayed,
          players: rec.players.map((p) => ({ seat: p.seat, player_name: p.playerName, player_id: p.playerId, user_id: p.userId ?? null, total_score: p.totalScore })),
        }
      : null,
    p_expected_version: expectedVersion ?? null,
    p_idle_users: idleUserIds,
    p_cutoff: new Date(cutoffMs).toISOString(),
  });
  if (error) throw new Error(`解散失敗：${error.message}`);
  if (data === "closed") await invalidateGameState(roomId);
  return data as DissolveResult;
}
