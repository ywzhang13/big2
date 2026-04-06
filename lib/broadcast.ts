import { getSupabaseServer } from "./supabase-server";

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
  await channel.send({
    type: "broadcast",
    event,
    payload,
  });
  supabase.removeChannel(channel);
}
