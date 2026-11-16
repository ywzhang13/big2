// 十三支觀戰：申請看某位玩家那一桌。POST { roomId, targetPlayerId }（同麻將：30 秒沒回應失效、30 秒內不能重複申請）
// 成功只通知被申請者本人（他的座位頻道 th_spectate_request，帶申請者 LINE 名稱、頭像，不帶帳號 id）
import { spectatorUser } from "@/lib/mahjong/spectate/server";
import { nowMs, requestSpectate } from "@/lib/mahjong/spectate/store";
import { loadRoom } from "@/lib/thirteen/db";
import { fail, json, send } from "@/lib/thirteen/server";
import { atThirteenTable, startedThirteen } from "@/lib/thirteen/spectate";

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => null);
    const roomId = body?.roomId, targetPlayerId = body?.targetPlayerId;
    if (typeof roomId !== "string" || !/^[0-9a-f-]{36}$/i.test(roomId) || typeof targetPlayerId !== "string") return fail(400, "bad_request");
    const user = await spectatorUser(request);
    if (user instanceof Response) return user;
    const room = await loadRoom(roomId);
    const s = startedThirteen(room);
    if (s instanceof Response) return s;
    if (await atThirteenTable(roomId, s, user.id)) return fail(403, "own_table");
    const target = s.players.find((p) => p.id === targetPlayerId);
    if (!target) return fail(400, "bad_target");
    const name = user.displayName ?? "LINE 使用者";
    const avatarUrl = user.pictureUrl?.startsWith("https://") ? user.pictureUrl : null;
    const r = await requestSpectate(roomId, user.id, targetPlayerId, name, avatarUrl);
    const serverNow = nowMs();
    if (!r.ok) {
      if (r.reason === "already_approved") return fail(409, "already_approved", undefined, { serverNow });
      if (r.reason === "already_pending") return fail(409, "already_pending", undefined, { expiresAt: r.until, serverNow });
      return fail(429, "cooldown", undefined, { cooldownUntil: r.until, serverNow });
    }
    await send(room!, [{ event: "th_spectate_request", payload: { playerId: targetPlayerId, requestId: r.requestId, name, avatarUrl, expiresAt: r.expiresAt, serverNow },
      to: { playerId: target.id, userId: target.userId } }]);
    return json({ status: "pending", expiresAt: r.expiresAt, serverNow });
  } catch (err) {
    console.error("[th-spectate] request", err instanceof Error ? err.message : err);
    return fail(500, "server_error");
  }
}
