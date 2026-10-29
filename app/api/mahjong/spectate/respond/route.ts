// 觀戰：被觀戰者同意／拒絕。POST { roomId, playerId, requestId, approve }（要是那個座位本人）
// 成功後在房間公開頻道廣播 mj_spectators（每位玩家的被觀戰人數），觀戰者收到後重新查狀態。
import { loadRoom } from "@/lib/mahjong/db";
import { seatOwnerError } from "@/lib/mahjong/access";
import { mjBroadcast } from "@/lib/mahjong/broadcast";
import { fail, startedState } from "@/lib/mahjong/spectate/server";
import { isUuid, viewerCounts } from "@/lib/mahjong/spectate/rules";
import { loadRoomSpectate, nowMs, respondSpectate } from "@/lib/mahjong/spectate/store";

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => null);
    const { roomId, playerId, requestId, approve } = body ?? {};
    if (typeof roomId !== "string" || typeof playerId !== "string" || typeof approve !== "boolean") return fail(400, "bad_request");
    const room = await loadRoom(roomId);
    const s = startedState(room);
    if (s instanceof Response) return s;
    const denied = await seatOwnerError(request, s, playerId);
    if (denied) return denied;
    if (!isUuid(requestId) || !(await respondSpectate(roomId, playerId, requestId, approve))) return fail(409, "not_pending");
    const counts = viewerCounts(await loadRoomSpectate(roomId), s.players.map((p) => p.id));
    await mjBroadcast(room!.code, "mj_spectators", { counts, serverNow: nowMs() });
    return Response.json({ status: approve ? "approved" : "rejected" });
  } catch (err) {
    console.error("[mj-spectate] respond", err instanceof Error ? err.message : err);
    return fail(500, "server_error");
  }
}
