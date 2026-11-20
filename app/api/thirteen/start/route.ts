// 十三支開始：POST { roomId, playerId }（房主本人）。2026-11-20 起（老闆定案）不再直接發牌，而是「發起開局確認」：
//   房主自己算同意，倒數 10 秒；另外三家要按 /api/thirteen/start-confirm 同意，四家都同意才發牌開局（開局後才扣房卡）。
//   倒數到了還有人沒按 → 不開局、回到等人，房主要再按一次開始（重新倒數 10 秒）。已經有一個還在倒數的確認就回那一個，不重新計時。
//   成功 → { ok, confirm: { startedBy, readyIds, seatIds, deadline, serverNow } }
//   錯誤照舊：不是本人 403 not_your_seat、不是房主 403 not_host、已開打 400 started、不滿 4 人 400 not_full、
//   有人被暫停 403 player_suspended（發起時擋一次；四家都同意、真的發牌前會再擋一次）、暫停開新局 503 paused
import { getAuthUser } from "@/lib/auth";
import { loadPlayers } from "@/lib/thirteen/db";
import { fail, newGamesPaused, pausedResponse, withRoom } from "@/lib/thirteen/server";
import { beginConfirm } from "@/lib/thirteen/startConfirm";
import { startBlockedError } from "@/lib/roomCard/guard";

export async function POST(request: Request) {
  if (newGamesPaused()) return pausedResponse(); // 退回前排空用：已開好的房也不能開打（上線計畫第 6 節）
  const body = await request.json().catch(() => null) as { roomId?: unknown; playerId?: unknown } | null;
  const user = await getAuthUser(request);
  if (!user) return fail(401, "not_logged_in");
  return withRoom(body?.roomId, async (room) => {
    const seats = await loadPlayers(room.id);
    const me = seats.find((p) => p.player_id === body?.playerId);
    if (!me || me.user_id !== user.id) return fail(403, "not_your_seat");
    if (room.host_id !== me.player_id || room.game_state.hostUserId !== user.id) return fail(403, "not_host", "只有房主可以開始");
    if (room.status !== "waiting") return fail(400, "started", "已經開始了");
    if (seats.length < 4) return fail(400, "not_full", "滿 4 人才能開始");
    // 房卡：房裡有人被暫停就不能開局（403 player_suspended，回那個人的座位和名字）
    const blocked = await startBlockedError(seats.map((p) => ({ userId: p.user_id, name: p.name, seat: p.seat })));
    if (blocked) return blocked;
    return beginConfirm(room, seats, me.player_id);
  });
}
