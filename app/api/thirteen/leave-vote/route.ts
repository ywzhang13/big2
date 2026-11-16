// 十三支解散投票：POST { roomId, playerId, approve }。有人不同意 → 取消；四家都同意 → 照中途解散寫紀錄（打完的局才算）並關房
// 審伯 2026-11-16 必修 3：最後一票先存檔（衝突就重讀重判，不會遺失、也不會沿用已經被否決的票），再關房；
// 關房暫時失敗不回成功，四家同意的狀態已經存著，之後任何請求（讀狀態、tick、再投一次）都會補關，紀錄只寫一次
import { saveGameStateIfUnchanged, StateConflictError } from "@/lib/thirteen/db";
import { allApproved, fail, finishMatch, json, saveAndAnnounce, seatOwnerError, withRoom } from "@/lib/thirteen/server";

export async function POST(request: Request) {
  const body = await request.json().catch(() => null) as { roomId?: unknown; playerId?: unknown; approve?: unknown } | null;
  if (typeof body?.approve !== "boolean") return fail(400, "bad_request");
  return withRoom(body.roomId, async (room) => {
    const e = await seatOwnerError(request, room.game_state, body.playerId);
    if (e) return e;
    const s = room.game_state;
    const lr = s.leaveRequest;
    if (!lr) return fail(409, "no_request", "目前沒有解散投票");
    const me = s.players.find((p) => p.id === body.playerId)!;
    const close = async (sv: number) => {
      const r = await finishMatch(room, s, sv, "dissolved", [{ event: "th_leave_vote", payload: { voterSeat: me.seat, approve: true, result: "granted" } }]);
      if (r === "changed") throw new StateConflictError(); // 有人剛存了新的：重讀重判
      if (r !== "closed" && r !== "already_closed") return fail(500, "close_failed", "解散沒有完成，請再試一次");
      return json({ ok: true, result: "granted" });
    };
    if (allApproved(s)) return close(s.stateVersion); // 四家都同意過、上次關房沒成功：不再收票，直接補關
    const base = s.stateVersion;
    const none = { autoSeats: [], revealed: false, nextStarted: false };
    if (!body.approve) {
      s.leaveRequest = null;
      const sv = await saveAndAnnounce(room, s, base, none, [{ event: "th_leave_vote", payload: { voterSeat: me.seat, approve: false, result: "denied" } }]);
      return json({ ok: true, result: "denied", sv });
    }
    if (!lr.approvedBy.includes(me.id)) lr.approvedBy.push(me.id);
    if (allApproved(s)) return close(await saveGameStateIfUnchanged(room.id, base, s));
    const sv = await saveAndAnnounce(room, s, base, none, [{ event: "th_leave_vote", payload: { voterSeat: me.seat, approve: true, result: "vote", approvedCount: lr.approvedBy.length } }]);
    return json({ ok: true, result: "vote", approvedCount: lr.approvedBy.length, sv });
  });
}
