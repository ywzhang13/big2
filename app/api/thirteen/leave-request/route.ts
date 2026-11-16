// 十三支發起中途解散：POST { roomId, playerId }（本人座位）。發起人算同意；沒閒置的其他玩家都同意才解散（閒置不計票，和麻將一樣）。
// 其他三家都閒置（例如都斷線）時，發起當下就成立：先存檔再關房（關房失敗之後的請求會補關）
import { saveGameStateIfUnchanged, StateConflictError } from "@/lib/thirteen/db";
import { clock, evaluateLeave } from "@/lib/thirteen/flow";
import { fail, finishMatch, json, saveAndAnnounce, seatOwnerError, withRoom } from "@/lib/thirteen/server";

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
    s.leaveRequest = { requesterId: me.id, approvedBy: [me.id], deniedBy: [] };
    const ev = evaluateLeave(s, clock.now())!;
    if (ev.result === "granted") {
      const sv = await saveGameStateIfUnchanged(room.id, base, s);
      const r = await finishMatch(room, s, sv, "dissolved", [{ event: "th_leave_vote", payload: { ...ev, result: "granted" } }]);
      if (r === "changed") throw new StateConflictError();
      if (r !== "closed" && r !== "already_closed") return fail(500, "close_failed", "解散沒有完成，請再試一次");
      return json({ ok: true, ...ev, result: "granted" });
    }
    const none = { autoSeats: [], revealed: false, nextStarted: false };
    const sv = await saveAndAnnounce(room, s, base, none, [{ event: "th_leave_request", payload: { requesterSeat: me.seat, requesterName: me.name, ...ev } }]);
    return json({ ok: true, sv, ...ev });
  });
}
