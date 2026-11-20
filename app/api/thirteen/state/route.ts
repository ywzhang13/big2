// 十三支讀狀態：GET ?roomId=&playerId=。要登入。
//   帶 playerId（必須是本人座位）→ 玩家畫面：亮牌前只有自己的手牌和三墩，別家只看得到送出了沒
//   不帶 playerId → 不在桌上的畫面：亮牌前誰的牌都看不到。只有這桌的人、或被這桌至少一位玩家同意觀戰的人能讀，其他人 403 not_allowed
//     （觀戰要先申請、被同意，比照麻將；觀戰者請用 /api/thirteen/spectate/view，內容一樣）
// 每次讀都先推進牌局（截止時間到了就代排、亮牌、開下一局），截止時間只看伺服器時間
import { getAuthUser, getPictureUrls } from "@/lib/auth";
import { loadRoomSpectate } from "@/lib/mahjong/spectate/store";
import { loadPlayers } from "@/lib/thirteen/db";
import { baseScoreOf, clock, viewFor } from "@/lib/thirteen/flow";
import { advanceAndSave, goneResponse, fail, json, seatOwnerError, withRoom } from "@/lib/thirteen/server";
import { confirmView, settleStartConfirm } from "@/lib/thirteen/startConfirm";

export async function GET(request: Request) {
  const q = new URL(request.url).searchParams;
  const playerId = q.get("playerId");
  const user = await getAuthUser(request);
  if (!user) return fail(401, "not_logged_in");
  return withRoom(q.get("roomId"), async (room) => {
    const seats = await loadPlayers(room.id);
    if (!playerId && !seats.some((p) => p.user_id === user.id) && !room.game_state.players.some((p) => p.userId === user.id)
      && !(room.status !== "waiting" && (await loadRoomSpectate(room.id)).some((r) => r.spectatorId === user.id && r.status === "approved")))
      return fail(403, "not_allowed");
    if (room.status === "waiting") {
      if (playerId && !seats.some((p) => p.player_id === playerId && p.user_id === user.id)) return fail(403, "not_your_seat");
      const pics = await getPictureUrls(seats.map((p) => p.user_id)); // 等人畫面的大頭照：座位表沒有存，照帳號查（開局後改讀牌局狀態裡存好的）
      const confirm = await settleStartConfirm(room, seats); // 開局確認：時間到或座位變了就作廢（保底輪詢也會觸發）
      return json({ status: "waiting", code: room.code, hostId: room.host_id, settings: room.game_state.settings, baseScore: baseScoreOf(room.game_state.settings),
        seats: seats.map((p, i) => ({ seat: p.seat, name: p.name, playerId: p.player_id, avatarUrl: pics[i] })), startConfirm: confirmView(confirm, clock.now()),
        lastStartConfirm: room.game_state.lastStartConfirm ?? null });
    }
    if (playerId) { const e = await seatOwnerError(request, room.game_state, playerId); if (e) return e; }
    const { s, sv, closed } = await advanceAndSave(room);
    if (closed) return goneResponse(room.id);
    return json({ status: room.status, code: room.code, sv, ...viewFor(s, playerId, clock.now()) });
  });
}
