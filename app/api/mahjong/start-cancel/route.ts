// 麻將開局確認：房主取消。POST { roomId, playerId, confirmId }（房主本人：登入帳號要是房主座位綁的帳號）。
//   200 { ok, cancelled: true }；沒有在倒數的確認 200 { ok, cancelled: false }；400 confirm_id_required；409 stale_confirm（上一輪的取消）；
//   不是房主 403；沒登入 401／不是本人 403
import { loadRoom, loadPlayers, retryOnConflict } from "@/lib/mahjong/db";
import { seatOwnerError } from "@/lib/mahjong/access";
import { cancelMj } from "@/lib/mahjong/startConfirm";

export async function POST(request: Request) {
  const body = await request.json().catch(() => null) as { roomId?: unknown; playerId?: unknown; confirmId?: unknown } | null;
  if (typeof body?.roomId !== "string" || typeof body.playerId !== "string") return Response.json({ error: "缺少必要欄位" }, { status: 400 });
  const { roomId, playerId, confirmId } = body as { roomId: string; playerId: string; confirmId?: unknown };
  return retryOnConflict(async (fresh) => {
    const room = await loadRoom(roomId, { fresh });
    if (!room) return Response.json({ error: "找不到房間" }, { status: 404 });
    if (room.host_id !== playerId) return Response.json({ error: "not_host", message: "只有房主可以取消" }, { status: 403 });
    const players = await loadPlayers(roomId);
    const denied = await seatOwnerError(request, null, playerId, players.find((p) => p.player_id === playerId)?.user_id ?? null);
    if (denied) return denied;
    return cancelMj(room, players, confirmId);
  });
}
