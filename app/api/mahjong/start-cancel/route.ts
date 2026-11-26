// 麻將開局確認：取消對戰（v3b 2026-11-27：倒數中也能取消）。POST { roomId, playerId, confirmId }（座位本人：登入帳號要是這個座位綁的帳號）。
//   200 { ok, cancelled: true }；沒有確認 200 { ok, cancelled: false }；400 confirm_id_required；409 stale_confirm（上一輪的取消）；
//   不在這次確認的座位 403 not_in_confirm；沒登入 401／不是本人 403
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
    const players = await loadPlayers(roomId);
    const denied = await seatOwnerError(request, null, playerId, players.find((p) => p.player_id === playerId)?.user_id ?? null);
    if (denied) return denied;
    return cancelMj(room, players, playerId, confirmId);
  });
}
