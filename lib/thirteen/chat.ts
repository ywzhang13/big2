// 十三支的聊天：和麻將共用同一套聊天紀錄（mj_chat_messages）、冷卻（mj_chat_rate）和 SQL 函式（mj_chat_post／mj_chat_history），
// 訊息格式、冷卻、保留則數也一樣（lib/mahjong/chat/rules.ts、lib/social/events.ts）。SQL 函式由 20261117_thirteen_chat.sql 認得十三支房間。
// 不一樣的只有「誰在這桌」（th_rooms／th_players）和「送到哪個頻道」（十三支的座位頻道）。麻將的聊天程式碼完全沒動。
// 第一版只有文字和快捷短語；語音、互動特效之後再接。
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { CHAT_HISTORY_LIMIT, RATE } from "@/lib/mahjong/chat/rules";
import { fromStored, toStored, type StoredMessage } from "@/lib/mahjong/chat/history";
import type { ChatMessage } from "@/lib/social/events";

/** postThirteenText 回傳：房間已經關掉，什麼都沒寫（和麻將 ROOM_CLOSED 一樣） */
export const ROOM_CLOSED = -1;

/** 檢查冷卻＋記下＋存進這房的聊天紀錄，一次完成；回 0＝已存、> 0＝冷卻中還要等幾毫秒、ROOM_CLOSED＝房間已關 */
export async function postThirteenText(roomId: string, userId: string, message: ChatMessage): Promise<number> {
  const r = RATE.text;
  const { data, error } = await getSupabaseAdmin().rpc("mj_chat_post", {
    p_room: roomId, p_user: userId, p_kind: "text",
    p_cooldown_ms: r.cooldownMs, p_burst_count: r.burstCount, p_burst_window_ms: r.burstWindowMs, p_burst_cooldown_ms: r.burstCooldownMs,
    p_msg: toStored(message), p_keep: CHAT_HISTORY_LIMIT,
  });
  if (error) throw new Error(`送出聊天失敗：${error.message}`);
  return Number(data) || 0;
}

/** 這房保存的聊天（舊到新，最多 CHAT_HISTORY_LIMIT 則） */
export async function loadThirteenHistory(roomId: string): Promise<ChatMessage[]> {
  const { data, error } = await getSupabaseAdmin().rpc("mj_chat_history", { p_room: roomId });
  if (error) throw new Error(`讀取聊天紀錄失敗：${error.message}`);
  return ((data ?? []) as { msg: StoredMessage }[]).map((r) => fromStored(r.msg, () => null));
}

/** 關房：刪掉這房的聊天紀錄和冷卻紀錄（失敗只記錄，漏掉的由下一則任何房的寫入清掉） */
export async function deleteThirteenChat(roomId: string): Promise<void> {
  const db = getSupabaseAdmin();
  for (const t of ["mj_chat_messages", "mj_chat_rate"]) {
    const { error } = await db.from(t).delete().eq("room_id", roomId);
    if (error) console.error(`[th-chat] 關房刪除 ${t} 失敗：`, error.message);
  }
}
