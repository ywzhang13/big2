// 十三支入座：POST { code, playerId, name } → { roomId, seat, playerId, channel }。要登入。
// 同一個帳號已經坐在這房 → 認回原座位（斷線重連）；回傳的 channel 是這個座位專屬的頻道（手牌只送這裡）
// 名字：去掉前後空白後 1～8 個字（表情符號算 1 個字，lib/thirteen/playerName.ts），不合法回 400 bad_name。
// 還在等人時重新加入、名字換了：座位表的名字換成新的，並發 th_player_joined（renamed: true）讓同桌重抓；開打後重新加入名字不變
// 入座的檢查和寫入都在資料庫函式 th_lobby_join 的同一個交易裡（鎖住房間那一列）：和離開、開局存檔、空房關閉、閒置清除不會交錯；
// 入座會把牌局版本 +1、更新房間的最後活動時間（舊的閒置清除快照因此失效，審伯 2026-11-18 必修 2）
import { getAuthUser } from "@/lib/auth";
import { loadPlayers, loadRoomByCode, lobbyJoin } from "@/lib/thirteen/db";
import { suspendedError } from "@/lib/roomCard/guard";
import { fail, json, privateChannel, send } from "@/lib/thirteen/server";
import { NAME_MESSAGE, normalizeName } from "@/lib/thirteen/playerName";

const MESSAGES: Record<string, [number, string?]> = {
  room_not_found: [404], started: [400, "牌局已經開始，不能加入"], full: [400, "房間已滿"],
  player_taken: [409], host_reserved: [403, "這是房主的座位"],
};

export async function POST(request: Request) {
  const user = await getAuthUser(request);
  if (!user) return fail(401, "not_logged_in");
  const body = await request.json().catch(() => null) as { code?: unknown; playerId?: unknown; name?: unknown } | null;
  const code = body?.code, playerId = body?.playerId;
  if (typeof code !== "string" || !/^\d{4}$/.test(code) || typeof playerId !== "string" || !playerId || playerId.length > 64)
    return fail(400, "bad_request");
  const name = normalizeName(body?.name);
  if (!name) return fail(400, "bad_name", NAME_MESSAGE);
  try {
    const room = await loadRoomByCode(code);
    if (!room) return fail(404, "room_not_found");
    // 房卡：被暫停的人不能加入新房（403 suspended）；已經坐在這房的人重新加入不擋，正在打的那一場照常打完
    if (!(await loadPlayers(room.id)).some((p) => p.user_id === user.id)) {
      const suspended = await suspendedError(user.id);
      if (suspended) return suspended;
    }
    const r = await lobbyJoin(room.id, playerId, name, user.id);
    if ("error" in r) { const [status, message] = MESSAGES[r.error] ?? [500]; return fail(status, r.error, message); }
    const channel = privateChannel(room.id, room.code, r.player_id, user.id);
    if (r.rejoined) {
      if (r.renamed) await send(room, [{ event: "th_player_joined", payload: { seat: r.seat, name, renamed: true } }], r.state_version);
      return json({ roomId: room.id, seat: r.seat, playerId: r.player_id, rejoined: true, channel });
    }
    await send(room, [{ event: "th_player_joined", payload: { seat: r.seat, name } }], r.state_version);
    return json({ roomId: room.id, seat: r.seat, playerId: r.player_id, channel });
  } catch (err) {
    return fail(500, "server_error", err instanceof Error ? err.message : "伺服器錯誤");
  }
}
