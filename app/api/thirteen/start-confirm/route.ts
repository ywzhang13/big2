// 十三支開局確認：同意。POST { roomId, playerId, confirmId }（本人座位；confirmId＝這一輪確認的編號，舊一輪的回 409 stale_confirm，沒帶回 400 confirm_id_required）。房主按開始後 10 秒內，四家都同意才發牌開局（老柯 2026-11-20，老闆定案）。
//   還在等 → { ok, confirm }；最後一家同意 → 發牌開局 { ok, started: true, handNo, arrangeDeadline }（開局存檔後才扣房卡）
//   409 no_confirm（房主還沒按開始或已取消）、409 expired（時間到了，請房主重新按開始）、409 seats_changed（有人離開或換人）
//   403 player_suspended（發牌前再檢查一次，有人被暫停就不開，這次確認作廢）、403 not_your_seat、503 paused
//   已經開局了（例如同時按、別人先觸發發牌）→ { ok, started: true }
import { getAuthUser } from "@/lib/auth";
import { loadPlayers } from "@/lib/thirteen/db";
import { fail, json, newGamesPaused, pausedResponse, withRoom } from "@/lib/thirteen/server";
import { agree } from "@/lib/thirteen/startConfirm";

export async function POST(request: Request) {
  if (newGamesPaused()) return pausedResponse();
  const body = await request.json().catch(() => null) as { roomId?: unknown; playerId?: unknown; confirmId?: unknown } | null;
  const user = await getAuthUser(request);
  if (!user) return fail(401, "not_logged_in");
  return withRoom(body?.roomId, async (room) => {
    const seats = await loadPlayers(room.id);
    const me = seats.find((p) => p.player_id === body?.playerId);
    if (!me || me.user_id !== user.id) return fail(403, "not_your_seat");
    if (room.status !== "waiting") return json({ ok: true, started: true, handNo: room.game_state.handNo });
    return agree(room, seats, me.player_id, body?.confirmId);
  });
}
