// 觀戰：用房號查房，列出四位玩家和「我」對每位的申請狀態。GET ?code=1234
// 只有 LINE 登入、而且不在這桌的人能用。回應不含任何帳號 id。格式見〈觀戰模式-前後端對接格式-2026-10-30.md〉3.1
import { loadRoom, loadRoomByCode } from "@/lib/mahjong/db";
import { atTable, fail, spectatorUser, startedState } from "@/lib/mahjong/spectate/server";
import { spectateStatus, viewerCounts } from "@/lib/mahjong/spectate/rules";
import { loadRoomSpectate, nowMs } from "@/lib/mahjong/spectate/store";

export async function GET(request: Request) {
  try {
    // 先驗身分（沒登入 401、遊客 403），才看房號和房間狀態：沒資格的人連「這房存不存在、開局沒」都查不到
    const user = await spectatorUser(request);
    if (user instanceof Response) return user;
    const code = new URL(request.url).searchParams.get("code") ?? "";
    if (!/^\d{4}$/.test(code)) return fail(400, "bad_request");
    const found = await loadRoomByCode(code);
    const room = found ? await loadRoom(found.id) : null;
    const s = startedState(room);
    if (s instanceof Response) return s;
    if (await atTable(room!.id, s, user.id)) return fail(403, "own_table");

    const rows = await loadRoomSpectate(room!.id);
    const now = nowMs();
    const counts = viewerCounts(rows, s.players.map((p) => p.id));
    const mine = rows.filter((r) => r.spectatorId === user.id);
    return Response.json({
      roomId: room!.id,
      code: room!.code,
      serverNow: now,
      players: [...s.players].sort((a, b) => a.seat - b.seat).map((p) => ({
        playerId: p.id,
        name: p.name,
        avatarUrl: p.avatarUrl ?? null,
        seat: p.seat,
        ...spectateStatus(mine.find((r) => r.targetPlayerId === p.id), now),
        viewerCount: counts[p.id],
      })),
    });
  } catch (err) {
    console.error("[mj-spectate] room", err instanceof Error ? err.message : err);
    return fail(500, "server_error");
  }
}
