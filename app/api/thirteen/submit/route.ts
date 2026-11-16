// 十三支送出三墩：POST { roomId, playerId, front, middle, back }（各是牌 id 陣列）。要登入、本人座位、本人的牌。
// 引擎檢查張數、重複、非本人牌、倒水；截止時間過了不收（已由系統代排）；送出後不能再改
import { cancelIfDenied, clock, revealIfReady, submit, touch } from "@/lib/thirteen/flow";
import { advanceAndSave, goneResponse, fail, json, saveAndAnnounce, seatOwnerError, withRoom } from "@/lib/thirteen/server";

export async function POST(request: Request) {
  const body = await request.json().catch(() => null) as { roomId?: unknown; playerId?: unknown; front?: unknown; middle?: unknown; back?: unknown } | null;
  return withRoom(body?.roomId, async (room) => {
    const e = await seatOwnerError(request, room.game_state, body?.playerId);
    if (e) return e;
    const { s, closed } = await advanceAndSave(room); // 截止時間先到了：這時已經代排好，下面會回 time_up
    if (closed) return goneResponse(room.id);
    const seat = s.players.find((p) => p.id === body!.playerId)!.seat;
    const now = clock.now();
    const r = submit(s, seat, { front: body!.front, middle: body!.middle, back: body!.back }, now);
    if (!r.ok) return json({ error: r.error, message: r.message }, r.error === "already_submitted" || r.error === "time_up" || r.error === "not_arranging" ? 409 : 400);
    const base = s.stateVersion;
    touch(s, body!.playerId as string, now); // 截止前自己送出＝牌局動作（閒置不計票用）
    const leaveCancelled = cancelIfDenied(s, now); // 他閒置時按過的不同意現在算數 → 取消投票
    const revealed = revealIfReady(s, now);
    const sv = await saveAndAnnounce(room, s, base, { autoSeats: [], revealed, nextStarted: false }, [{ event: "th_submitted", payload: { seat } },
      ...(leaveCancelled ? [{ event: "th_leave_vote", payload: { voterSeat: seat, approve: false, result: "denied" } }] : [])]);
    return json({ ok: true, sv, revealed, leaveCancelled });
  });
}
