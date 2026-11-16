// 十三支觀戰：被申請的玩家同意／拒絕。POST { roomId, playerId, requestId, approve }（要是那個座位本人）
// 成功後公開頻道廣播 th_spectators（每位玩家的被觀戰人數）
import { isUuid, viewerCounts } from "@/lib/mahjong/spectate/rules";
import { loadRoomSpectate, nowMs, respondSpectate } from "@/lib/mahjong/spectate/store";
import { loadRoom } from "@/lib/thirteen/db";
import { fail, json, seatOwnerError, send } from "@/lib/thirteen/server";
import { startedThirteen } from "@/lib/thirteen/spectate";

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => null);
    const { roomId, playerId, requestId, approve } = body ?? {};
    if (typeof roomId !== "string" || !/^[0-9a-f-]{36}$/i.test(roomId) || typeof playerId !== "string" || typeof approve !== "boolean") return fail(400, "bad_request");
    const room = await loadRoom(roomId);
    const s = startedThirteen(room);
    if (s instanceof Response) return s;
    const denied = await seatOwnerError(request, s, playerId);
    if (denied) return denied;
    if (!isUuid(requestId) || !(await respondSpectate(roomId, playerId, requestId, approve))) return fail(409, "not_pending");
    const counts = viewerCounts(await loadRoomSpectate(roomId), s.players.map((p) => p.id));
    await send(room!, [{ event: "th_spectators", payload: { counts, serverNow: nowMs() } }]);
    return json({ status: approve ? "approved" : "rejected" });
  } catch (err) {
    console.error("[th-spectate] respond", err instanceof Error ? err.message : err);
    return fail(500, "server_error");
  }
}
