// 十三支推進牌局：POST { roomId, playerId }。前端倒數到 0、或亮牌後等下一局時呼叫；
// 伺服器自己看時間決定要不要代排、亮牌、開下一局（前端的倒數只是提醒，不算數）。保底輪詢讀 state 也會做同一件事
import { advanceAndSave, goneResponse, json, seatOwnerError, withRoom } from "@/lib/thirteen/server";

export async function POST(request: Request) {
  const body = await request.json().catch(() => null) as { roomId?: unknown; playerId?: unknown } | null;
  return withRoom(body?.roomId, async (room) => {
    if (room.status === "waiting") return json({ phase: "waiting" });
    const e = await seatOwnerError(request, room.game_state, body?.playerId);
    if (e) return e;
    const { s, sv, closed } = await advanceAndSave(room);
    if (closed) return goneResponse(room.id);
    return json({ phase: s.phase, handNo: s.handNo, sv });
  });
}
