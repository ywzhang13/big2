// 麻將開局確認：同意。POST { roomId, playerId, confirmId }（座位本人；confirmId＝這一輪確認的編號）。規則見 lib/mahjong/startConfirm.ts。
//   還在等 → { ok, confirm }；最後一家同意 → 發牌開局 { ok, started: true }（開局存檔後才扣房卡）
//   400 confirm_id_required（沒帶編號）、409 stale_confirm（上一輪的編號）、409 expired（時間到了）、409 no_confirm（沒按開始或已取消）、
//   409 started（已經開局）、403 player_suspended（發牌前再檢查一次，有人被暫停就不開，這次作廢）、401／403（不是座位本人）
import { loadRoom, loadPlayers, retryOnConflict } from "@/lib/mahjong/db";
import { seatOwnerError } from "@/lib/mahjong/access";
import { agreeMj } from "@/lib/mahjong/startConfirm";

export async function POST(request: Request) {
  const acceptedAt = Date.now(); // 受理時刻：之後查資料庫、衝突重試花的時間不算（比照審伯 R3）
  const body = await request.json().catch(() => null) as { roomId?: unknown; playerId?: unknown; confirmId?: unknown } | null;
  if (typeof body?.roomId !== "string" || typeof body.playerId !== "string") return Response.json({ error: "缺少必要欄位" }, { status: 400 });
  const { roomId, playerId, confirmId } = body as { roomId: string; playerId: string; confirmId?: unknown };
  return retryOnConflict(async (fresh) => {
    const room = await loadRoom(roomId, { fresh });
    if (!room) return Response.json({ error: "找不到房間" }, { status: 404 });
    const players = await loadPlayers(roomId);
    const me = players.find((p) => p.player_id === playerId);
    if (!me) return Response.json({ error: "not_your_seat" }, { status: 403 });
    const denied = await seatOwnerError(request, room.status === "waiting" ? null : room.game_state, playerId, room.status === "waiting" ? me.user_id ?? null : undefined);
    if (denied) return denied;
    return agreeMj(room, players, playerId, confirmId, acceptedAt);
  });
}
