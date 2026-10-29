// 觀戰：看某位「已同意」玩家的視角。GET ?roomId=…&target=<playerId>
// 每次都重新檢查同意（收回、房間結束後下一次就拿不到）。只帶目標玩家的手牌；另外三家只有公開資料（暗槓照樣蓋牌）。
// 同一位觀戰者、同一房每秒最多 10 次，超過 429 rate_limited（retryAfterMs）。
import { loadRoom, toSpectatorGameState } from "@/lib/mahjong/db";
import { fail, spectatorUser, startedState } from "@/lib/mahjong/spectate/server";
import { takeView, viewerCounts } from "@/lib/mahjong/spectate/rules";
import { loadRoomSpectate, nowMs } from "@/lib/mahjong/spectate/store";

export async function GET(request: Request) {
  try {
    const q = new URL(request.url).searchParams;
    const roomId = q.get("roomId"), target = q.get("target");
    if (!roomId || !target) return fail(400, "bad_request");
    const user = await spectatorUser(request);
    if (user instanceof Response) return user;
    // 限流：在讀房間、讀觀戰資料之前就擋
    const wait = takeView(roomId, user.id, nowMs());
    if (wait > 0) return fail(429, "rate_limited", { retryAfterMs: wait });
    const room = await loadRoom(roomId);
    const s = startedState(room);
    if (s instanceof Response) return s;
    const t = s.players.find((p) => p.id === target);
    const rows = await loadRoomSpectate(roomId);
    const ok = !!t && rows.some((r) => r.spectatorId === user.id && r.targetPlayerId === target && r.status === "approved");
    if (!ok) return fail(403, "not_approved");
    return Response.json({
      roomId: room!.id,
      code: room!.code,
      status: room!.status,
      target: { playerId: t.id, name: t.name, seat: t.seat },
      spectatorCounts: viewerCounts(rows, s.players.map((p) => p.id)),
      gameState: toSpectatorGameState(s, t.id),
    });
  } catch (err) {
    console.error("[mj-spectate] view", err instanceof Error ? err.message : err);
    return fail(500, "server_error");
  }
}
