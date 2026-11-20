// 十三支開局確認：房主取消。POST { roomId, playerId, confirmId }（房主本人；confirmId 對不上＝舊一輪的取消，回 409 stale_confirm）→ { ok, cancelled }；回到等人狀態，不發牌、不扣房卡（老柯 2026-11-20）
import { getAuthUser } from "@/lib/auth";
import { loadPlayers } from "@/lib/thirteen/db";
import { fail, withRoom } from "@/lib/thirteen/server";
import { cancelByHost } from "@/lib/thirteen/startConfirm";

export async function POST(request: Request) {
  const body = await request.json().catch(() => null) as { roomId?: unknown; playerId?: unknown; confirmId?: unknown } | null;
  const user = await getAuthUser(request);
  if (!user) return fail(401, "not_logged_in");
  return withRoom(body?.roomId, async (room) => {
    const seats = await loadPlayers(room.id);
    const me = seats.find((p) => p.player_id === body?.playerId);
    if (!me || me.user_id !== user.id) return fail(403, "not_your_seat");
    if (room.host_id !== me.player_id || room.game_state.hostUserId !== user.id) return fail(403, "not_host", "只有房主可以取消");
    if (room.status !== "waiting") return fail(400, "started", "已經開始了");
    return cancelByHost(room, body?.confirmId);
  });
}
