// 十三支觀戰：被觀戰者收回同意。POST { roomId, playerId, requestId? }（沒帶 requestId＝收回全部；要是那個座位本人）
// 收回當下生效：觀戰者下一次讀觀戰畫面、聊天紀錄就是 403。成功後廣播 th_spectators
import { isUuid, viewerCounts } from "@/lib/mahjong/spectate/rules";
import { loadRoomSpectate, nowMs, revokeSpectate } from "@/lib/mahjong/spectate/store";
import { loadRoom } from "@/lib/thirteen/db";
import { fail, json, seatOwnerError, send } from "@/lib/thirteen/server";
import { startedThirteen } from "@/lib/thirteen/spectate";

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => null);
    const { roomId, playerId, requestId } = body ?? {};
    if (typeof roomId !== "string" || !/^[0-9a-f-]{36}$/i.test(roomId) || typeof playerId !== "string") return fail(400, "bad_request");
    if (requestId !== undefined && requestId !== null && !isUuid(requestId)) return fail(400, "bad_request");
    const room = await loadRoom(roomId);
    const s = startedThirteen(room);
    if (s instanceof Response) return s;
    const denied = await seatOwnerError(request, s, playerId);
    if (denied) return denied;
    const revoked = await revokeSpectate(roomId, playerId, requestId ?? null);
    const counts = viewerCounts(await loadRoomSpectate(roomId), s.players.map((p) => p.id));
    await send(room!, [{ event: "th_spectators", payload: { counts, serverNow: nowMs() } }]);
    return json({ revoked });
  } catch (err) {
    console.error("[th-spectate] revoke", err instanceof Error ? err.message : err);
    return fail(500, "server_error");
  }
}
