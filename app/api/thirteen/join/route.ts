// 十三支入座：POST { code, playerId, name } → { roomId, seat, playerId, channel }。要登入。
// 同一個帳號已經坐在這房 → 認回原座位（斷線重連）；回傳的 channel 是這個座位專屬的頻道（手牌只送這裡）
import { getAuthUser } from "@/lib/auth";
import { insertPlayer, loadPlayers, loadRoomByCode } from "@/lib/thirteen/db";
import { fail, json, privateChannel, send } from "@/lib/thirteen/server";

export async function POST(request: Request) {
  const user = await getAuthUser(request);
  if (!user) return fail(401, "not_logged_in");
  const body = await request.json().catch(() => null) as { code?: unknown; playerId?: unknown; name?: unknown } | null;
  const code = body?.code, playerId = body?.playerId, name = typeof body?.name === "string" ? body.name.trim() : "";
  if (typeof code !== "string" || !/^\d{4}$/.test(code) || typeof playerId !== "string" || !playerId || playerId.length > 64 || !name || name.length > 20)
    return fail(400, "bad_request");
  try {
    const room = await loadRoomByCode(code);
    if (!room) return fail(404, "room_not_found");
    for (let attempt = 0; attempt < 3; attempt++) {
      const seats = await loadPlayers(room.id);
      const mine = seats.find((p) => p.user_id === user.id);
      if (mine) return json({ roomId: room.id, seat: mine.seat, playerId: mine.player_id, rejoined: true, channel: privateChannel(room.id, room.code, mine.player_id, user.id) });
      if (room.status !== "waiting") return fail(400, "started", "牌局已經開始，不能加入");
      if (seats.length >= 4) return fail(400, "full", "房間已滿");
      if (seats.some((p) => p.player_id === playerId)) return fail(409, "player_taken");
      // 房主的座位只有開房的帳號能坐（不然別人知道房主 id 就能搶先坐下、開局）
      if (playerId === room.host_id && room.game_state?.hostUserId !== user.id) return fail(403, "host_reserved", "這是房主的座位");
      const seat = [0, 1, 2, 3].find((n) => !seats.some((p) => p.seat === n))!;
      if (await insertPlayer({ room_id: room.id, player_id: playerId, name, seat, user_id: user.id }) === "ok") {
        await send(room, [{ event: "th_player_joined", payload: { seat, name } }]);
        return json({ roomId: room.id, seat, playerId, channel: privateChannel(room.id, room.code, playerId, user.id) });
      }
    }
    return fail(409, "busy", "同時有人入座，請再試一次");
  } catch (err) {
    return fail(500, "server_error", err instanceof Error ? err.message : "伺服器錯誤");
  }
}
