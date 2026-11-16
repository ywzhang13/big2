// 十三支解散投票：POST { roomId, playerId, approve }。規則和麻將一致（flow.ts evaluateLeave）：
//   ・超過 3 分鐘沒做牌局動作的人不計票（同意、不同意都不算）；沒閒置的其他玩家都同意 → 照中途解散寫紀錄（打完的局才算）並關房
//   ・沒閒置的人按不同意 → 取消
// 審伯 2026-11-16 必修 3：最後一票先存檔（衝突就重讀重判，不會遺失、也不會沿用已經被否決的票），再關房；
// 關房暫時失敗不回成功，票已經存著，之後任何請求（讀狀態、tick、再投一次）都會補關，紀錄只寫一次
import { saveGameStateIfUnchanged, StateConflictError } from "@/lib/thirteen/db";
import { clock, evaluateLeave, isIdle } from "@/lib/thirteen/flow";
import { fail, finishMatch, json, leaveGranted, saveAndAnnounce, seatOwnerError, withRoom } from "@/lib/thirteen/server";

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
    const now = clock.now();
    const close = async (sv: number) => {
      const ev = evaluateLeave(s, now)!;
      const r = await finishMatch(room, s, sv, "dissolved", [{ event: "th_leave_vote", payload: { voterSeat: me.seat, approve: true, ...ev, result: "granted" } }]);
      if (r === "changed") throw new StateConflictError(); // 有人剛存了新的：重讀重判
      if (r !== "closed" && r !== "already_closed") return fail(500, "close_failed", "解散沒有完成，請再試一次");
      return json({ ok: true, ...ev, result: "granted" });
    };
    if (leaveGranted(s)) return close(s.stateVersion); // 已經成立、上次關房沒成功：不再收票，直接補關
    const base = s.stateVersion;
    const none = { autoSeats: [], revealed: false, nextStarted: false };
    const idle = isIdle(s, me.id, now);
    if (!body.approve) {
      if (!idle) {
        s.leaveRequest = null;
        const sv = await saveAndAnnounce(room, s, base, none, [{ event: "th_leave_vote", payload: { voterSeat: me.seat, approve: false, result: "denied" } }]);
        return json({ ok: true, result: "denied", sv });
      }
      // 閒置的人不同意：記下但現在不算（恢復投票權時才算）。每人只留最後一票：換成不同意就拿掉他先前的同意
      lr.approvedBy = lr.approvedBy.filter((x) => x !== me.id);
      lr.deniedBy = [...new Set([...(lr.deniedBy ?? []), me.id])];
    } else {
      // 同意：每人只留最後一票，換成同意就拿掉他先前（閒置時）的不同意，不能留下撤不掉的否決（審伯 2026-11-17 必修）
      lr.deniedBy = (lr.deniedBy ?? []).filter((x) => x !== me.id);
      if (!lr.approvedBy.includes(me.id)) lr.approvedBy.push(me.id);
    }
    const ev = evaluateLeave(s, now)!;
    if (ev.result === "granted") return close(await saveGameStateIfUnchanged(room.id, base, s));
    if (ev.result === "denied") { // 有投票權的人之前的不同意已經算數（例如閒置後又恢復）：取消，不能停在否決
      s.leaveRequest = null;
      const sv = await saveAndAnnounce(room, s, base, none, [{ event: "th_leave_vote", payload: { voterSeat: me.seat, approve: body.approve, result: "denied" } }]);
      return json({ ok: true, result: "denied", sv });
    }
    const sv = await saveAndAnnounce(room, s, base, none, [{ event: "th_leave_vote", payload: { voterSeat: me.seat, approve: body.approve, counted: !idle, ...ev, result: "vote" } }]);
    return json({ ok: true, ...ev, result: "vote", counted: !idle, sv });
  });
}
