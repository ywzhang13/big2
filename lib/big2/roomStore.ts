// 大老二加入房間、讀牌桌狀態的資料存取（/api/game/join、/api/game/state 用），查詢內容和原本寫在路由裡的一樣。
// 和其他大老二路由一樣用公開金鑰。測試時整個檔案換成 tests/support/stub-big2-room-store.ts 的記憶體版本。
import { getSupabaseServer } from "@/lib/supabase-server";

/** 用房號找房間；找不到（或查詢失敗）回 null，和原本一樣當成「找不到房間」 */
export async function findRoomByCode(code: string): Promise<{ id: string; code: string; status: string } | null> {
  const { data, error } = await getSupabaseServer().from("big2_rooms").select("id, code, status").eq("code", code).single();
  return error || !data ? null : data;
}

/** 房裡的座位（座位號小的在前）；查詢失敗丟錯 */
export async function loadSeats(roomId: string): Promise<{ seat: number; player_id: string }[]> {
  const { data, error } = await getSupabaseServer()
    .from("big2_players")
    .select("seat, player_id")
    .eq("room_id", roomId)
    .order("seat", { ascending: true });
  if (error) throw new Error(`查詢玩家失敗：${error.message}`);
  return data ?? [];
}

/** 坐下；成功回 null，失敗回錯誤代碼（23505＝座位被搶走） */
export async function insertSeat(row: { room_id: string; player_id: string; name: string; seat: number }): Promise<{ code?: string } | null> {
  const { error } = await getSupabaseServer().from("big2_players").insert({ ...row, hand: [], card_count: 0 });
  return error ? { code: error.code } : null;
}

export async function loadRoomState(roomId: string) {
  const { data, error } = await getSupabaseServer()
    .from("big2_rooms")
    .select("id, code, status, host_id, current_turn, last_play, pass_count, round_starter, scores, ready_players")
    .eq("id", roomId)
    .single();
  return error || !data ? null : data;
}

/** 房裡全部玩家（含手牌，路由只回自己的）；查詢失敗回 null */
export async function loadRoomPlayers(roomId: string) {
  const { data, error } = await getSupabaseServer()
    .from("big2_players")
    .select("player_id, name, seat, card_count, is_finished, finish_order, hand")
    .eq("room_id", roomId)
    .order("seat", { ascending: true });
  return error || !data ? null : data;
}
