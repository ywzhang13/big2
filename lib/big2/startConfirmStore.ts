// 大老二開局確認（lib/big2/startConfirm.ts）的資料存取。和其他大老二路由一樣用公開金鑰。
// 確認狀態存在 big2_rooms.start_confirm、上一次沒開成的原因存在 last_start_confirm（20261120_big2_start_confirm.sql）。
// 寫入一律帶 row_version 條件（trigger 每次更新 +1）：同時按同意、同時退出、同時發牌，只會成功一個，輸的重讀再做。
// 測試時整個檔案換成 tests/support/stub-big2-start-confirm-store.ts 的記憶體版本。
import { getSupabaseServer } from "@/lib/supabase-server";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import type { StartConfirm } from "@/lib/lobby/startConfirm";

/** 存在資料庫的確認（和十三支、麻將同一個格式） */
export type Big2StartConfirm = StartConfirm;
export type Big2CancelReason = "host" | "timeout" | "seats_changed" | "cancelled"; // "cancelled"＝有人按取消對戰（v3c，by＝誰）
export interface Big2LastStartConfirm { reason: Big2CancelReason; missingIds: string[]; at: number; by?: string }
export interface Big2ConfirmRoom {
  id: string;
  code: string;
  status: string;
  host_id: string | null;
  row_version: number;
  start_confirm: Big2StartConfirm | null;
  last_start_confirm: Big2LastStartConfirm | null;
}

export async function loadConfirmRoom(roomId: string): Promise<Big2ConfirmRoom | null> {
  const { data, error } = await getSupabaseServer()
    .from("big2_rooms")
    .select("id, code, status, host_id, row_version, start_confirm, last_start_confirm")
    .eq("id", roomId)
    .maybeSingle();
  if (error) throw new Error(`查詢房間失敗：${error.message}`);
  return data ? { ...(data as Big2ConfirmRoom), row_version: Number(data.row_version) } : null;
}

/** 房裡的玩家 id，依座位 */
export async function loadSeatIds(roomId: string): Promise<string[]> {
  const { data, error } = await getSupabaseServer().from("big2_players").select("player_id, seat").eq("room_id", roomId).order("seat", { ascending: true });
  if (error) throw new Error(`查詢玩家失敗：${error.message}`);
  return (data ?? []).map((p) => String(p.player_id));
}

// 入座憑證的雜湊放在 big2_seat_keys：只有伺服器（service_role）讀寫，公開金鑰讀不到也改不了（審伯複審 R4 的資料庫路徑）。
// 大老二其他資料照舊用公開金鑰，只有這一張表用伺服器金鑰（麻將、十三支一直都是這樣）。

/** 存這個座位的入座憑證雜湊（同一房同一個玩家 id 再入座就換新） */
export async function saveSeatKeyHash(roomId: string, playerId: string, keyHash: string): Promise<void> {
  const { error } = await getSupabaseAdmin().from("big2_seat_keys").upsert({ room_id: roomId, player_id: playerId, key_hash: keyHash }, { onConflict: "room_id,player_id" });
  if (error) throw new Error(`存入座憑證失敗：${error.message}`);
}

/** 這個座位的入座憑證雜湊（不在這間房、或上線前入座的＝null） */
export async function loadSeatKeyHash(roomId: string, playerId: string): Promise<string | null> {
  const seated = await getSupabaseServer().from("big2_players").select("player_id").eq("room_id", roomId).eq("player_id", playerId).maybeSingle();
  if (seated.error) throw new Error(`查詢玩家失敗：${seated.error.message}`);
  if (!seated.data) return null; // 已經離座：舊憑證不算
  const { data, error } = await getSupabaseAdmin().from("big2_seat_keys").select("key_hash").eq("room_id", roomId).eq("player_id", playerId).maybeSingle();
  if (error) throw new Error(`查詢入座憑證失敗：${error.message}`);
  return (data?.key_hash as string | null | undefined) ?? null;
}

/**
 * 只有 row_version 還是讀到的值、狀態還在 statuses 裡才寫入。
 * 寫入了回寫入後的 row_version（trigger +1；發牌要綁定這個版本，審伯 R2），被別人搶先回 null（呼叫端重讀再做）
 */
export async function updateRoomIf(roomId: string, rowVersion: number, statuses: string[], patch: Record<string, unknown>): Promise<number | null> {
  const { data, error } = await getSupabaseServer()
    .from("big2_rooms")
    .update(patch)
    .eq("id", roomId)
    .eq("row_version", rowVersion)
    .in("status", statuses)
    .select("row_version");
  if (error) throw new Error(`更新房間失敗：${error.message}`);
  return data && data.length > 0 ? Number(data[0].row_version) : null;
}
