// 觀戰：申請看某位玩家的視角。POST { roomId, targetPlayerId }
// 30 秒內沒回應就失效；同一位觀戰者對同一位玩家，30 秒內只能申請一次（資料庫時間，見 20261030_mahjong_spectate.sql）。
// 成功後只通知被申請者（座位頻道 mj_spectate_request，帶申請者 LINE 本名、頭像，不帶帳號 id）。
import { loadRoom } from "@/lib/mahjong/db";
import { mjBroadcast } from "@/lib/mahjong/broadcast";
import { atTable, fail, spectatorUser, startedState } from "@/lib/mahjong/spectate/server";
import { nowMs, requestSpectate } from "@/lib/mahjong/spectate/store";

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => null);
    const roomId = body?.roomId, targetPlayerId = body?.targetPlayerId;
    if (typeof roomId !== "string" || typeof targetPlayerId !== "string") return fail(400, "bad_request");
    const user = await spectatorUser(request);
    if (user instanceof Response) return user;
    const room = await loadRoom(roomId);
    const s = startedState(room);
    if (s instanceof Response) return s;
    if (await atTable(roomId, s, user.id)) return fail(403, "own_table");
    if (!s.players.some((p) => p.id === targetPlayerId)) return fail(400, "bad_target");

    const name = user.displayName ?? "LINE 使用者";
    const avatarUrl = user.pictureUrl?.startsWith("https://") ? user.pictureUrl : null;
    const r = await requestSpectate(roomId, user.id, targetPlayerId, name, avatarUrl);
    const serverNow = nowMs();
    if (!r.ok) {
      if (r.reason === "already_approved") return fail(409, "already_approved", { serverNow });
      if (r.reason === "already_pending") return fail(409, "already_pending", { expiresAt: r.until, serverNow });
      return fail(429, "cooldown", { cooldownUntil: r.until, serverNow });
    }
    await mjBroadcast(room!.code, "mj_spectate_request", {
      playerId: targetPlayerId, requestId: r.requestId, name, avatarUrl, expiresAt: r.expiresAt, serverNow,
    });
    return Response.json({ status: "pending", expiresAt: r.expiresAt, serverNow });
  } catch (err) {
    console.error("[mj-spectate] request", err instanceof Error ? err.message : err);
    return fail(500, "server_error");
  }
}
