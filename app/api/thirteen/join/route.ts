// 十三支入座：POST { code, playerId, name } → { roomId, seat, playerId, channel }。要登入。
// 同一個帳號已經坐在這房 → 認回原座位（斷線重連）；回傳的 channel 是這個座位專屬的頻道（手牌只送這裡）
// 入座的檢查和寫入都在資料庫函式 th_lobby_join 的同一個交易裡（鎖住房間那一列）：和離開、開局存檔、空房關閉、閒置清除不會交錯；
// 入座會把牌局版本 +1、更新房間的最後活動時間（舊的閒置清除快照因此失效，審伯 2026-11-18 必修 2）
import { getAuthUser } from "@/lib/auth";
import { loadRoomByCode, lobbyJoin } from "@/lib/thirteen/db";
import { fail, json, privateChannel, send } from "@/lib/thirteen/server";

const MESSAGES: Record<string, [number, string?]> = {
  room_not_found: [404], started: [400, "牌局已經開始，不能加入"], full: [400, "房間已滿"],
  player_taken: [409], host_reserved: [403, "這是房主的座位"],
};

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
    const r = await lobbyJoin(room.id, playerId, name, user.id);
    if ("error" in r) { const [status, message] = MESSAGES[r.error] ?? [500]; return fail(status, r.error, message); }
    const channel = privateChannel(room.id, room.code, r.player_id, user.id);
    if (r.rejoined) return json({ roomId: room.id, seat: r.seat, playerId: r.player_id, rejoined: true, channel });
    await send(room, [{ event: "th_player_joined", payload: { seat: r.seat, name } }], r.state_version);
    return json({ roomId: room.id, seat: r.seat, playerId: r.player_id, channel });
  } catch (err) {
    return fail(500, "server_error", err instanceof Error ? err.message : "伺服器錯誤");
  }
}
