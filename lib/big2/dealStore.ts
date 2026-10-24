// 大老二發牌（lib/deal-and-start.ts）的資料存取。和其他大老二路由一樣用公開金鑰。
// 測試時整個檔案換成 tests/support/stub-big2-deal-store.ts 的記憶體版本。
import { getSupabaseServer } from "@/lib/supabase-server";
import type { Card } from "@/lib/constants";

/** 發牌前先記下房間的 row_version 和狀態（最後改成 playing 時用它做條件） */
export async function loadRoomForDeal(roomId: string): Promise<{ row_version: number; status: string } | null> {
  const { data, error } = await getSupabaseServer().from("big2_rooms").select("row_version, status").eq("id", roomId).maybeSingle();
  if (error) throw new Error(`查詢房間失敗：${error.message}`);
  return data ? { row_version: Number(data.row_version), status: String(data.status) } : null;
}

export async function loadSeatedPlayers(roomId: string): Promise<{ id: string; player_id: string; name: string; seat: number }[]> {
  const { data, error } = await getSupabaseServer()
    .from("big2_players")
    .select("id, player_id, name, seat")
    .eq("room_id", roomId)
    .order("seat", { ascending: true });
  if (error) throw new Error("無法取得玩家資料");
  return data ?? [];
}

export async function saveHand(playerRowId: string, hand: Card[]): Promise<void> {
  const { error } = await getSupabaseServer()
    .from("big2_players")
    .update({ hand, card_count: 13, is_finished: false, finish_order: null })
    .eq("id", playerRowId);
  if (error) throw new Error("更新玩家手牌失敗");
}

/**
 * 把房間改成 playing：只有 row_version 仍是發牌前讀到的值、而且狀態還在 statuses 裡才寫入。
 * 回傳 true＝寫入了；false＝中間有人動過房間（例如有人退出），呼叫端不能開局。
 */
export async function startRoomIfUnchanged(roomId: string, rowVersion: number, statuses: string[], update: Record<string, unknown>): Promise<boolean> {
  const { data, error } = await getSupabaseServer()
    .from("big2_rooms")
    .update(update)
    .eq("id", roomId)
    .eq("row_version", rowVersion)
    .in("status", statuses)
    .select("id");
  if (error) throw new Error("更新房間狀態失敗");
  return !!data && data.length > 0;
}
