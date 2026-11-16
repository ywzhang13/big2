// 十三支下一局：POST { roomId, playerId }。亮牌後按「下一局」；四家都按了就開，沒按的人（例如斷線）等時間到也會自動開
import { clock, isOver, shouldStartNext, startHand } from "@/lib/thirteen/flow";
import { advanceAndSave, goneResponse, fail, json, saveAndAnnounce, seatOwnerError, withRoom } from "@/lib/thirteen/server";

export async function POST(request: Request) {
  const body = await request.json().catch(() => null) as { roomId?: unknown; playerId?: unknown } | null;
  return withRoom(body?.roomId, async (room) => {
    const e = await seatOwnerError(request, room.game_state, body?.playerId);
    if (e) return e;
    const { s, sv: sv0, closed } = await advanceAndSave(room);
    if (closed) return goneResponse(room.id);
    if (s.phase !== "revealed" || isOver(s)) return json({ ok: true, phase: s.phase, handNo: s.handNo, sv: sv0 }); // 已經開了下一局（或打完了）
    const pid = body!.playerId as string;
    if ((s.nextReady ?? []).includes(pid)) return json({ ok: true, phase: s.phase, handNo: s.handNo, sv: sv0 });
    const base = s.stateVersion;
    s.nextReady = [...(s.nextReady ?? []), pid];
    const nextStarted = shouldStartNext(s, clock.now());
    if (nextStarted) startHand(s, clock.now());
    const seat = s.players.find((p) => p.id === pid)!.seat;
    const sv = await saveAndAnnounce(room, s, base, { autoSeats: [], revealed: false, nextStarted }, [{ event: "th_next_ready", payload: { seat } }]);
    return json({ ok: true, phase: s.phase, handNo: s.handNo, sv });
  });
}
