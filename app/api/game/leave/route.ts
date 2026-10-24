// POST /api/game/leave：大老二等人階段（還沒發牌，含準備確認中）退出房間（老闆 2026-10-24）。
// body { roomId, playerId }（大老二不接登入，和其他大老二路由一樣用玩家 id 認人）。
// 成功 200 { ok: true }；不在這間房（或房間已關）404 not_in_room；已發牌開打 409 game_in_progress（大老二開局後先不提供離開）。
// 做法：先用 row_version 做條件寫入佔住房間（同時開始發牌時只有一邊成功）；房主退出就交給最早加入、還在房裡的人；
// 準備確認中有人退出 → 取消準備確認、回到等人；再刪掉座位、廣播 player_left。房裡沒人了就關房（不寫對局紀錄）。
// 刪掉座位後，同一個玩家 id 再用房號加入會被當成新加入（join 只在等人、有空位時收）。
import { claimRoom, deletePlayer, loadPlayers, loadRoom } from "@/lib/big2/leaveStore";
import { closeRoom } from "@/lib/records/store";
import { broadcast } from "@/lib/broadcast";

const notInRoom = () => Response.json({ error: "not_in_room" }, { status: 404 });
const MAX_ATTEMPTS = 5;

export async function POST(request: Request) {
  let body: { roomId?: string; playerId?: string };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "缺少必要欄位" }, { status: 400 });
  }
  const { roomId, playerId } = body ?? {};
  if (!roomId || !playerId) return Response.json({ error: "缺少必要欄位" }, { status: 400 });

  try {
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      const room = await loadRoom(roomId);
      if (!room) return notInRoom();
      const players = await loadPlayers(roomId);
      const mine = players.find((p) => p.player_id === playerId);
      if (!mine) return notInRoom();
      const played = room.scores && Object.keys(room.scores).length > 0; // 已經打過至少一場
      if ((room.status !== "waiting" && room.status !== "ready_check") || played) {
        return Response.json({ error: "game_in_progress" }, { status: 409 });
      }

      const rest = players.filter((p) => p.player_id !== playerId); // 最早加入的在前
      const wasHost = room.host_id === playerId;
      const hostId = wasHost ? (rest[0]?.player_id ?? null) : room.host_id;
      const patch: Record<string, unknown> = { status: "waiting", ready_players: [] }; // 準備確認中有人走 → 回到等人
      if (wasHost && hostId) patch.host_id = hostId;
      const newVersion = await claimRoom(roomId, room.row_version, patch);
      if (newVersion === null) continue; // 中間有人動過（例如開始發牌）：重讀再判斷

      await deletePlayer(roomId, playerId);
      if (rest.length === 0) {
        await closeRoom("big2", roomId, null, { rowVersion: newVersion }); // 最後一個人走了：關房，不寫紀錄
      } else {
        await broadcast(room.code, "player_left", {
          playerId,
          seat: mine.seat,
          playerCount: rest.length,
          hostId,
          readyCheckCancelled: room.status === "ready_check",
        });
      }
      return Response.json({ ok: true, hostId, closed: rest.length === 0 });
    }
    return Response.json({ error: "同時有太多動作，請再試一次" }, { status: 409 });
  } catch {
    return Response.json({ error: "伺服器錯誤" }, { status: 500 });
  }
}
