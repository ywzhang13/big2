// 十三支等人階段離開房間：POST { roomId }，用登入身分認座位（比照麻將 /api/mahjong/leave）。
//   成功 200 { ok: true, hostId, closed }；不在這間房（或房間已關）404 not_in_room；已開局 409 game_in_progress（開局後走解散投票）
//   ・房主離開：房主交給最早入座、還在房裡的人（房主座位 id 和帳號一起換，之後只有他能開局）
//   ・最後一個人離開：關房（一局都沒打，不寫紀錄），聊天、觀戰資料一起清掉
// 刪座位、交接房主、版本 +1、空房刪除都在資料庫函式 th_lobby_leave 的同一個交易裡（鎖住房間那一列），
// 和入座、開局存檔、閒置清除不會交錯（審伯 2026-11-18 必修 1、3）。
import { getAuthUser } from "@/lib/auth";
import { loadRoom, lobbyLeave } from "@/lib/thirteen/db";
import { emptyLobbyClosed, fail, json, send, withRoom } from "@/lib/thirteen/server";
import { settleStartConfirm } from "@/lib/thirteen/startConfirm";

export async function POST(request: Request) {
  const body = await request.json().catch(() => null) as { roomId?: unknown } | null;
  const user = await getAuthUser(request);
  if (!user) return fail(401, "not_logged_in");
  const roomId = body?.roomId;
  if (typeof roomId !== "string" || !/^[0-9a-f-]{36}$/i.test(roomId)) return fail(400, "bad_request");
  try {
    const room = await loadRoom(roomId); // 只用來拿房號（廣播、清資料用）；離開的判斷全在 th_lobby_leave 裡
    if (!room) return fail(404, "not_in_room");
    const r = await lobbyLeave(roomId, user.id);
    if ("error" in r) return r.error === "game_in_progress" ? fail(409, r.error, "已經開局，請用解散投票") : fail(404, r.error);
    try {
      if (r.closed) await emptyLobbyClosed(room);
      else {
        await send(room, [{ event: "th_player_left", payload: { playerId: r.player_id, seat: r.seat, playerCount: r.player_count, hostId: r.host_id } }], r.state_version);
        // 開局確認期間有人離開：這次確認作廢（座位變了），回到等人、房主要重新按開始
        if (room.game_state?.startConfirm) await withRoom(roomId, async (fresh) => { await settleStartConfirm(fresh); return json({ ok: true }); });
      }
    } catch (err) {
      console.error(`[th-leave] 房 ${roomId} 離開後清資料／廣播失敗（離開已成立）：`, err instanceof Error ? err.message : err);
    }
    return json({ ok: true, hostId: r.host_id, closed: r.closed });
  } catch (err) {
    return fail(500, "server_error", err instanceof Error ? err.message : "伺服器錯誤");
  }
}
