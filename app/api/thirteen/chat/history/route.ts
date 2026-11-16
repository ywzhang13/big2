// 十三支聊天紀錄：GET /api/thirteen/chat/history?roomId=。和麻將 /api/mahjong/chat/history 一樣：
//   ・同桌玩家（含訪客）可以讀；觀戰者要在這房被至少一位玩家同意觀戰才能讀，另外回他自己的觀戰頻道
//   ・其他人 403 not_allowed；沒登入 401；房間不在 404（關房時紀錄一起刪掉）
import { getAuthUser } from "@/lib/auth";
import { spectatorChannelName } from "@/lib/mahjong/access";
import { CHAT_HISTORY_LIMIT } from "@/lib/mahjong/chat/rules";
import { loadRoomSpectate } from "@/lib/mahjong/spectate/store";
import { loadThirteenHistory } from "@/lib/thirteen/chat";
import { chatMembers, fail, json } from "@/lib/thirteen/server";

export async function GET(request: Request) {
  try {
    const roomId = new URL(request.url).searchParams.get("roomId");
    if (!roomId) return fail(400, "bad_request");
    const user = await getAuthUser(request);
    if (!user) return fail(401, "not_logged_in");
    const room = await chatMembers(roomId);
    if (room instanceof Response) return room;
    const seated = room.members.some((m) => m.userId && m.userId === user.id);
    const spectator = !seated && (await loadRoomSpectate(room.id)).some((r) => r.spectatorId === user.id && r.status === "approved");
    if (!seated && !spectator) return fail(403, "not_allowed");
    return json({ roomId: room.id, limit: CHAT_HISTORY_LIMIT, role: seated ? "player" : "spectator", messages: await loadThirteenHistory(room.id),
      ...(spectator ? { spectatorChannel: spectatorChannelName(room.code, room.id, user.id) } : {}) });
  } catch (err) {
    console.error("[th-chat] history", err instanceof Error ? err.message : err);
    return fail(500, "server_error");
  }
}
