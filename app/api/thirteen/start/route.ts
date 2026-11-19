// 十三支開局：POST { roomId, playerId }（房主本人）。四家到齊才能開；發牌、設理牌截止時間，每家的牌只送到自己的座位頻道
import { getAuthUser, getPictureUrls } from "@/lib/auth";
import { loadPlayers } from "@/lib/thirteen/db";
import { clock, seatPlayers, startHand, touch } from "@/lib/thirteen/flow";
import { fail, json, saveAndAnnounce, withRoom } from "@/lib/thirteen/server";

export async function POST(request: Request) {
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
    const s = room.game_state;
    const base = s.stateVersion;
    seatPlayers(s, seats, await getPictureUrls(seats.map((p) => p.user_id))); // 大頭照開局時查一次（同麻將），查不到是 null、不擋開局
    startHand(s, clock.now());
    touch(s, me.player_id, clock.now()); // 房主開局＝牌局動作；其他人從開局時間起算
    const sv = await saveAndAnnounce(room, s, base, { autoSeats: [], revealed: false, nextStarted: true }, [], "playing");
    return json({ ok: true, handNo: s.handNo, arrangeDeadline: s.arrangeDeadline, sv });
  });
}
