import { getSupabaseServer } from "../supabase-server";

/**
 * Broadcast an event to a mahjong room's Realtime channel.
 */
export async function mjBroadcast(
  roomCode: string,
  event: string,
  payload: Record<string, unknown>
): Promise<void> {
  const supabase = getSupabaseServer();
  const channel = supabase.channel(`mj-${roomCode}`);
  await channel.send({
    type: "broadcast",
    event,
    payload,
  });
  supabase.removeChannel(channel);
}

/**
 * Batch broadcast: send multiple events through a single channel so they
 * are delivered in order to all clients. Much faster than N separate
 * mjBroadcast calls and avoids ordering races.
 */
export async function mjBroadcastBatch(
  roomCode: string,
  events: { event: string; payload: Record<string, unknown> }[]
): Promise<void> {
  if (events.length === 0) return;
  const supabase = getSupabaseServer();
  const channel = supabase.channel(`mj-${roomCode}`);
  for (const { event, payload } of events) {
    await channel.send({ type: "broadcast", event, payload });
  }
  supabase.removeChannel(channel);
}
