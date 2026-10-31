import { getSupabaseServer } from "../supabase-server";
import { routeEvents, withVersion } from "./access";

/**
 * Broadcast an event to a mahjong room's Realtime channel.
 * 私人事件（手牌等）會改送到本人的座位頻道（見 access.ts）。
 */
export async function mjBroadcast(
  roomCode: string,
  event: string,
  payload: Record<string, unknown>,
  sv?: number
): Promise<void> {
  await mjBroadcastBatch(roomCode, [{ event, payload }], sv);
}

/**
 * Batch broadcast: send multiple events through a single channel so they
 * are delivered in order to all clients. Much faster than N separate
 * mjBroadcast calls and avoids ordering races.
 * 同一個頻道的事件照原本順序送；不同頻道之間（公開／座位）不保證到達順序。
 * sv：這次存檔後的牌局版本號（saveGameStateIfUnchanged 的回傳值）。有給就放進每個事件的 payload，
 *   前端記住看過的最大版本，跳號（中間漏了事件）就立刻補抓一次狀態，不用等保險輪詢（老馬 2026-11-01）。
 *   沒有存檔的事件（聊天、語音、特效、觀戰人數）不帶。
 */
export async function mjBroadcastBatch(
  roomCode: string,
  events: { event: string; payload: Record<string, unknown> }[],
  sv?: number
): Promise<void> {
  if (events.length === 0) return;
  const supabase = getSupabaseServer();
  const channels = new Map<string, ReturnType<typeof supabase.channel>>();
  for (const { channel: name, event, payload } of routeEvents(roomCode, withVersion(events, sv))) {
    let channel = channels.get(name);
    if (!channel) {
      channel = supabase.channel(name);
      channels.set(name, channel);
    }
    await channel.send({ type: "broadcast", event, payload });
  }
  for (const channel of channels.values()) supabase.removeChannel(channel);
}
