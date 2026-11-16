// 十三支發起中途解散：POST { roomId, playerId }（本人座位）。發起人算同意；其他三家都同意才解散（沿用麻將的投票）
import { fail, json, saveAndAnnounce, seatOwnerError, withRoom } from "@/lib/thirteen/server";

export async function POST(request: Request) {
  const body = await request.json().catch(() => null) as { roomId?: unknown; playerId?: unknown } | null;
  return withRoom(body?.roomId, async (room) => {
    if (room.status !== "playing") return fail(400, "not_playing");
    const e = await seatOwnerError(request, room.game_state, body?.playerId);
    if (e) return e;
    const s = room.game_state;
    if (s.leaveRequest) return fail(409, "already_requested", "已經有人發起解散投票");
    const me = s.players.find((p) => p.id === body!.playerId)!;
    const base = s.stateVersion;
    s.leaveRequest = { requesterId: me.id, approvedBy: [me.id] };
    const none = { autoSeats: [], revealed: false, nextStarted: false };
    const sv = await saveAndAnnounce(room, s, base, none, [{ event: "th_leave_request", payload: { requesterSeat: me.seat, requesterName: me.name } }]);
    return json({ ok: true, sv });
  });
}
