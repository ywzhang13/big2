// 十三支開局確認：取消對戰（v3b 2026-11-27：倒數中也能取消）。POST { roomId, playerId, confirmId }（座位本人）→ { ok, cancelled }；回到等人狀態，不發牌、不扣房卡。
//   不在這次確認的座位 403 not_in_confirm；confirmId 對不上＝舊一輪 409 stale_confirm
import { getAuthUser } from "@/lib/auth";
import { loadPlayers } from "@/lib/thirteen/db";
import { fail, withRoom } from "@/lib/thirteen/server";
import { cancelByPlayer } from "@/lib/thirteen/startConfirm";

export async function POST(request: Request) {
  const body = await request.json().catch(() => null) as { roomId?: unknown; playerId?: unknown; confirmId?: unknown } | null;
  const user = await getAuthUser(request);
  if (!user) return fail(401, "not_logged_in");
  return withRoom(body?.roomId, async (room) => {
    const seats = await loadPlayers(room.id);
    const me = seats.find((p) => p.player_id === body?.playerId);
    if (!me || me.user_id !== user.id) return fail(403, "not_your_seat");
    if (room.status !== "waiting") return fail(400, "started", "已經開始了");
    return cancelByPlayer(room, seats, me.player_id, body?.confirmId);
  });
}
