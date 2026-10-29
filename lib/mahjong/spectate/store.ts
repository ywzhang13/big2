// 觀戰申請的資料庫存取（只在伺服器用 service role）。
// 測試時整個檔案會被換成 tests/support/stub-spectate-store.ts（照樣跑真的 SQL 函式）。
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { SPECTATE_KEEP_MS, SPECTATE_WINDOW_MS, toRequestResult, type RequestResult, type SpectateRow } from "./rules";

/** 伺服器現在時間（測試換成可控制的時鐘） */
export const nowMs = () => Date.now();

export async function requestSpectate(roomId: string, spectatorId: string, targetPlayerId: string, name: string, avatarUrl: string | null): Promise<RequestResult> {
  const { data, error } = await getSupabaseAdmin().rpc("mj_spectate_request", {
    p_room_id: roomId, p_spectator_id: spectatorId, p_target_id: targetPlayerId, p_name: name, p_avatar: avatarUrl, p_window_ms: SPECTATE_WINDOW_MS,
  });
  if (error) throw new Error(`觀戰申請失敗：${error.message}`);
  return toRequestResult(data);
}

/** 同意／拒絕；true＝有改到（還在有效期內的 pending） */
export async function respondSpectate(roomId: string, targetPlayerId: string, requestId: string, approve: boolean): Promise<boolean> {
  const { data, error } = await getSupabaseAdmin().rpc("mj_spectate_respond", {
    p_room_id: roomId, p_target_id: targetPlayerId, p_request_id: requestId, p_approve: approve, p_window_ms: SPECTATE_WINDOW_MS,
  });
  if (error) throw new Error(`觀戰回應失敗：${error.message}`);
  return data === true;
}

/** 收回（requestId 為 null＝這位玩家的全部）；回傳收回幾位 */
export async function revokeSpectate(roomId: string, targetPlayerId: string, requestId: string | null): Promise<number> {
  const { data, error } = await getSupabaseAdmin().rpc("mj_spectate_revoke", { p_room_id: roomId, p_target_id: targetPlayerId, p_request_id: requestId });
  if (error) throw new Error(`觀戰收回失敗：${error.message}`);
  return Number(data) || 0;
}

/** 這房所有觀戰列 */
export async function loadRoomSpectate(roomId: string): Promise<SpectateRow[]> {
  const { data, error } = await getSupabaseAdmin()
    .from("mj_spectate")
    .select("spectator_id, target_player_id, request_id, status, spectator_name, spectator_avatar, requested_at")
    .eq("room_id", roomId);
  if (error) throw new Error(`讀取觀戰資料失敗：${error.message}`);
  return (data ?? []).map((r) => ({
    spectatorId: String(r.spectator_id),
    targetPlayerId: String(r.target_player_id),
    requestId: String(r.request_id),
    status: r.status,
    name: String(r.spectator_name),
    avatarUrl: r.spectator_avatar ?? null,
    requestedAt: Date.parse(r.requested_at),
  }));
}

/** 房間關閉：刪掉這房的觀戰列（全部同意一併失效） */
export async function deleteRoomSpectate(roomId: string): Promise<void> {
  const { error } = await getSupabaseAdmin().from("mj_spectate").delete().eq("room_id", roomId);
  if (error) throw new Error(`刪除觀戰資料失敗：${error.message}`);
}

/** 刪掉 7 天前的觀戰列（不分房間、不分狀態） */
export async function deleteOldSpectate(): Promise<void> {
  const { error } = await getSupabaseAdmin().from("mj_spectate").delete().lt("requested_at", new Date(nowMs() - SPECTATE_KEEP_MS).toISOString());
  if (error) throw new Error(`清除舊觀戰資料失敗：${error.message}`);
}
