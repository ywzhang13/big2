// 觀戰：被觀戰者收回同意。POST { roomId, playerId, requestId? }（沒帶 requestId＝收回全部；要是那個座位本人）
// 收回當下生效：觀戰者下一次讀視角就是 403 not_approved。成功後廣播 mj_spectators。
import { loadRoom } from "@/lib/mahjong/db";
import { seatOwnerError } from "@/lib/mahjong/access";
import { mjBroadcast } from "@/lib/mahjong/broadcast";
import { fail, startedState } from "@/lib/mahjong/spectate/server";
import { isUuid, viewerCounts } from "@/lib/mahjong/spectate/rules";
import { loadRoomSpectate, nowMs, revokeSpectate } from "@/lib/mahjong/spectate/store";

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => null);
    const { roomId, playerId, requestId } = body ?? {};
    if (typeof roomId !== "string" || typeof playerId !== "string") return fail(400, "bad_request");
    if (requestId !== undefined && requestId !== null && !isUuid(requestId)) return fail(400, "bad_request");
    const room = await loadRoom(roomId);
    const s = startedState(room);
    if (s instanceof Response) return s;
    const denied = await seatOwnerError(request, s, playerId);
    if (denied) return denied;
    const revoked = await revokeSpectate(roomId, playerId, requestId ?? null);
    const counts = viewerCounts(await loadRoomSpectate(roomId), s.players.map((p) => p.id));
    await mjBroadcast(room!.code, "mj_spectators", { counts, serverNow: nowMs() });
    return Response.json({ revoked });
  } catch (err) {
    console.error("[mj-spectate] revoke", err instanceof Error ? err.message : err);
    return fail(500, "server_error");
  }
}
