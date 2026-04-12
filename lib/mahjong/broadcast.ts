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
