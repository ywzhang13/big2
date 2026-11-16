// 十三支觀戰：被觀戰者的管理清單（還沒回應的申請、已同意的人）。GET ?roomId=…&playerId=…（要是那個座位本人）
import { SPECTATE_WINDOW_MS } from "@/lib/mahjong/spectate/rules";
import { loadRoomSpectate, nowMs } from "@/lib/mahjong/spectate/store";
import { loadRoom } from "@/lib/thirteen/db";
import { fail, json, seatOwnerError } from "@/lib/thirteen/server";
import { startedThirteen } from "@/lib/thirteen/spectate";

export async function GET(request: Request) {
  try {
    const q = new URL(request.url).searchParams;
    const roomId = q.get("roomId"), playerId = q.get("playerId");
    if (!roomId || !/^[0-9a-f-]{36}$/i.test(roomId) || !playerId) return fail(400, "bad_request");
    const room = await loadRoom(roomId);
    const s = startedThirteen(room);
    if (s instanceof Response) return s;
    const denied = await seatOwnerError(request, s, playerId);
    if (denied) return denied;
    const now = nowMs();
    const mine = (await loadRoomSpectate(roomId)).filter((r) => r.targetPlayerId === playerId).sort((a, b) => a.requestedAt - b.requestedAt);
    return json({
      serverNow: now,
      pending: mine.filter((r) => r.status === "pending" && r.requestedAt + SPECTATE_WINDOW_MS > now)
        .map((r) => ({ requestId: r.requestId, name: r.name, avatarUrl: r.avatarUrl, expiresAt: r.requestedAt + SPECTATE_WINDOW_MS })),
      approved: mine.filter((r) => r.status === "approved").map((r) => ({ requestId: r.requestId, name: r.name, avatarUrl: r.avatarUrl })),
    });
  } catch (err) {
    console.error("[th-spectate] manage", err instanceof Error ? err.message : err);
    return fail(500, "server_error");
  }
}
