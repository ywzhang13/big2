import { getSupabaseServer } from "../supabase-server";
import { routeEvents } from "./access";

/**
 * Broadcast an event to a mahjong room's Realtime channel.
 * 私人事件（手牌等）會改送到本人的座位頻道（見 access.ts）。
 */
export async function mjBroadcast(
  roomCode: string,
  event: string,
  payload: Record<string, unknown>
): Promise<void> {
  await mjBroadcastBatch(roomCode, [{ event, payload }]);
}

/**
 * Batch broadcast: send multiple events through a single channel so they
 * are delivered in order to all clients. Much faster than N separate
 * mjBroadcast calls and avoids ordering races.
 * 同一個頻道的事件照原本順序送；不同頻道之間（公開／座位）不保證到達順序。
 */
export async function mjBroadcastBatch(
  roomCode: string,
  events: { event: string; payload: Record<string, unknown> }[]
): Promise<void> {
  if (events.length === 0) return;
  const supabase = getSupabaseServer();
  const channels = new Map<string, ReturnType<typeof supabase.channel>>();
  for (const { channel: name, event, payload } of routeEvents(roomCode, events)) {
    let channel = channels.get(name);
    if (!channel) {
      channel = supabase.channel(name);
      channels.set(name, channel);
    }
    await channel.send({ type: "broadcast", event, payload });
  }
  for (const channel of channels.values()) supabase.removeChannel(channel);
}
