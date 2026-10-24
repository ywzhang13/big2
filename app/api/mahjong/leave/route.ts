// POST /api/mahjong/leave：等人階段（還沒開局）退出房間（老闆 2026-10-24）。
// body { roomId }，用登入身分認座位。成功 200 { ok: true, hostId, closed }；不在這間房（或房間已關）404 not_in_room；
// 已開局 409 game_in_progress（開局後照舊走 leave-request／leave-vote 投票離開）。
// 和開局同時送時只能有一邊成功，順序是「先刪座位、再用大廳狀態版本做條件寫入」：
//   ・開局在刪座位之前讀到 4 個座位 → 它存檔用的是舊版本；我們先寫入，它就衝突重讀、看到 3 人而不開局；
//     它先寫入（已開局），我們的條件寫入失敗 → 把座位補回去、回 409，牌局 4 人都在。
//   ・開局在刪座位之後才讀座位 → 只看到 3 人，不會開局。
// 房主退出就把房主交給最早加入、還在房裡的人（同一個條件寫入一起換）；房裡沒人了就關房（一局都沒打，不寫對局紀錄）。
// 座位刪掉後 my-room 就不會再回這間房。沒有成功（錯誤、連續衝突、開局搶先）一律先補回座位再回錯誤，房主不變。
import { claimLobbyForLeave, deletePlayer, insertPlayer, loadLobbySeats, loadRoom, StateConflictError } from "@/lib/mahjong/db";
import { mjBroadcast } from "@/lib/mahjong/broadcast";
import { getAuthUser } from "@/lib/auth";
import { notLoggedIn } from "@/lib/mahjong/access";
import { closeMahjongRoom } from "@/lib/records/close";
import type { MahjongGameState } from "@/lib/mahjong/gameState";

const notInRoom = () => Response.json({ error: "not_in_room" }, { status: 404 });
const inProgress = () => Response.json({ error: "game_in_progress" }, { status: 409 });
const MAX_ATTEMPTS = 5;

export async function POST(request: Request) {
  let body: { roomId?: string };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "缺少必要欄位" }, { status: 400 });
  }
  if (!body?.roomId) return Response.json({ error: "缺少必要欄位" }, { status: 400 });
  const user = await getAuthUser(request);
  if (!user) return notLoggedIn();
  const roomId = body.roomId;

  // 座位刪掉之後、條件寫入成功之前，任何一條沒走到成功回應的路（一般錯誤、連續版本衝突、開局搶先）
  // 都要先把座位補回去再回錯誤；房主（host_id）只在條件寫入成功時才會換，失敗時不會被改（審伯 2026-10-24）
  let removed: { room_id: string; player_id: string; name: string; seat: number; user_id: string | null } | null = null;
  const restoreSeat = async () => {
    if (!removed) return;
    const row = removed;
    removed = null;
    await insertPlayer(row).catch((err) => console.error(`[mj-leave] 房 ${row.room_id} 補回座位失敗：`, err instanceof Error ? err.message : err));
  };
  try {
    const room = await loadRoom(roomId, { fresh: true });
    if (!room) return notInRoom();
    const seats = await loadLobbySeats(roomId);
    const mine = seats.find((p) => p.user_id === user.id);
    if (!mine) return notInRoom();
    if (room.status !== "waiting") return inProgress();

    if ((await deletePlayer(roomId, mine.player_id)) === 0) return notInRoom(); // 同一個人同時按兩次：另一次已經刪了
    removed = { room_id: roomId, player_id: mine.player_id, name: mine.name, seat: mine.seat, user_id: mine.user_id };

    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      const cur = attempt === 0 ? room : await loadRoom(roomId, { fresh: true });
      if (!cur) return Response.json({ ok: true, hostId: null, closed: true }); // 房間已被關掉（最後一個人同時退出）
      if (cur.status !== "waiting") {
        // 開局搶先存檔了（讀到的還是 4 人）：座位補回去，讓牌局和座位一致
        await restoreSeat();
        return inProgress();
      }
      const rest = (await loadLobbySeats(roomId)).filter((p) => p.player_id !== mine.player_id); // 最早加入的在前
      const newHost = cur.host_id === mine.player_id ? rest[0]?.player_id : undefined;
      const lobby = { ...((cur.game_state as unknown as Record<string, unknown> | null) ?? {}) };
      try {
        await claimLobbyForLeave(roomId, lobby.stateVersion as number | undefined, lobby, newHost);
      } catch (err) {
        if (err instanceof StateConflictError) continue; // 版本被別的動作改了：重讀再判斷
        throw err;
      }
      removed = null; // 條件寫入成功：退出已經成立，之後的關房、廣播失敗也不補回座位、照樣回成功
      const hostId = newHost ?? (cur.host_id === mine.player_id ? null : cur.host_id);
      try {
        if (rest.length === 0) {
          // 最後一個人走了：關房（還在大廳、一局都沒打 → 不寫對局紀錄；關房失敗之後由閒置清理再關）
          await closeMahjongRoom(roomId, room.code, lobby as unknown as MahjongGameState, "dissolved", { stateVersion: lobby.stateVersion as number });
        } else {
          await mjBroadcast(room.code, "mj_player_left", { playerId: mine.player_id, seat: mine.seat, playerCount: rest.length, hostId });
        }
      } catch (err) {
        console.error(`[mj-leave] 房 ${roomId} 退出後關房／廣播失敗（退出已成立）：`, err instanceof Error ? err.message : err);
      }
      return Response.json({ ok: true, hostId, closed: rest.length === 0 });
    }
    await restoreSeat(); // 連續版本衝突：退出沒有成立
    return Response.json({ error: "同時有太多動作，請再試一次" }, { status: 409 });
  } catch {
    await restoreSeat();
    return Response.json({ error: "伺服器錯誤" }, { status: 500 });
  }
}
