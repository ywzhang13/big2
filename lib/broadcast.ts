import type { RealtimeChannel } from "@supabase/supabase-js";
import { getSupabaseServer } from "./supabase-server";

/**
 * 伺服器送一則廣播（三款共用；麻將、十三支的 mjBroadcastBatch 也走這裡）。
 * 用 httpSend 明確走 REST（2026-11-27 廣播改寫第 1 批）：伺服器的頻道從來沒有訂閱，
 * 舊的 channel.send() 每次都被自動退回 REST，還印「即將淘汰」警告。送出的內容一樣：
 * 同一個頻道名、事件名、payload。
 * 失敗照舊不丟錯：舊的 send() 失敗只回 'error'／'timed out'、不 throw，呼叫的 API 照常回應；
 * httpSend 失敗會 reject，所以這裡接住，只記一行 warn（前端有輪詢和版本號補抓）。
 */
export async function sendBroadcast(channel: RealtimeChannel, event: string, payload: Record<string, unknown>): Promise<void> {
  try {
    await channel.httpSend(event, payload);
  } catch (err) {
    console.warn(`[broadcast] 送出失敗 ${event}：`, err instanceof Error ? err.message : err);
  }
}

/**
 * Broadcast an event to a room's Realtime channel.
 */
export async function broadcast(
  roomCode: string,
  event: string,
  payload: Record<string, unknown>
): Promise<void> {
  const supabase = getSupabaseServer();
  const channel = supabase.channel(`big2-${roomCode}`);
  await sendBroadcast(channel, event, payload);
  supabase.removeChannel(channel);
}
