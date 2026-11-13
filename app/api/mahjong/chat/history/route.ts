// 聊天紀錄：GET /api/mahjong/chat/history?roomId=<房間 id>
// 回這房目前保存的聊天（舊到新，最多 CHAT_HISTORY_LIMIT 則），重新整理、斷線重連、中途回來都用這支補齊。
//   ・同桌玩家（含訪客）：可以讀
//   ・觀戰者：在這房至少被一位玩家同意觀戰，才可以讀；另外回 spectatorChannel（他自己的、綁這一場），訂閱它就能即時收到聊天和互動特效
//   ・其他人 403 not_allowed；沒登入 401；房間不在 404（關房時紀錄一起刪掉）
// 只在進房、重連時呼叫，打牌當下不會呼叫。格式見 lib/social/README.md。
import { getAuthUser } from "@/lib/auth";
import { spectatorChannelName } from "@/lib/mahjong/access";
import { CHAT_HISTORY_LIMIT } from "@/lib/mahjong/chat/rules";
import { loadHistory } from "@/lib/mahjong/chat/store";
import { loadPlayers, loadRoom } from "@/lib/mahjong/db";
import { fail } from "@/lib/mahjong/effects/members";
import type { MahjongGameState } from "@/lib/mahjong/gameState";
import { loadRoomSpectate } from "@/lib/mahjong/spectate/store";

export async function GET(request: Request) {
  try {
    const roomId = new URL(request.url).searchParams.get("roomId");
    if (!roomId) return fail(400, "bad_request");
    const user = await getAuthUser(request);
    if (!user) return fail(401, "not_logged_in");
    const room = await loadRoom(roomId);
    if (!room) return fail(404, "room_not_found");
    const gs = room.game_state as Partial<MahjongGameState> | null;
    const seated = gs?.players?.length
      ? gs.players.some((p) => p.userId && p.userId === user.id)
      : (await loadPlayers(roomId)).some((p) => p.user_id && p.user_id === user.id);
    let spectator = false;
    if (!seated) {
      spectator = (await loadRoomSpectate(roomId)).some((r) => r.spectatorId === user.id && r.status === "approved");
      if (!spectator) return fail(403, "not_allowed");
    }
    const messages = await loadHistory(roomId);
    return Response.json({
      roomId, limit: CHAT_HISTORY_LIMIT, role: seated ? "player" : "spectator", messages,
      ...(spectator ? { spectatorChannel: spectatorChannelName(room.code, roomId, user.id) } : {}),
    });
  } catch (err) {
    console.error("[mj-chat] history", err instanceof Error ? err.message : err);
    return fail(500, "server_error");
  }
}
