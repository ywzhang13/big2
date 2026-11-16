// 十三支觀戰：用房號查房，列出四位玩家和「我」對每位的申請狀態。GET ?code=1234（同麻將 /api/mahjong/spectate/room）
// 只有 LINE 登入（非遊客）、而且不在這桌的人能用；先驗身分才看房號。回應不含任何帳號 id
import { spectatorUser } from "@/lib/mahjong/spectate/server";
import { spectateStatus, viewerCounts } from "@/lib/mahjong/spectate/rules";
import { loadRoomSpectate, nowMs } from "@/lib/mahjong/spectate/store";
import { loadRoomByCode } from "@/lib/thirteen/db";
import { fail, json } from "@/lib/thirteen/server";
import { atThirteenTable, startedThirteen } from "@/lib/thirteen/spectate";

export async function GET(request: Request) {
  try {
    const user = await spectatorUser(request);
    if (user instanceof Response) return user;
    const code = new URL(request.url).searchParams.get("code") ?? "";
    if (!/^\d{4}$/.test(code)) return fail(400, "bad_request");
    const room = await loadRoomByCode(code);
    const s = startedThirteen(room);
    if (s instanceof Response) return s;
    if (await atThirteenTable(room!.id, s, user.id)) return fail(403, "own_table");
    const rows = await loadRoomSpectate(room!.id);
    const now = nowMs();
    const counts = viewerCounts(rows, s.players.map((p) => p.id));
    const mine = rows.filter((r) => r.spectatorId === user.id);
    return json({ roomId: room!.id, code: room!.code, serverNow: now,
      players: s.players.map((p) => ({ playerId: p.id, name: p.name, seat: p.seat,
        ...spectateStatus(mine.find((r) => r.targetPlayerId === p.id), now), viewerCount: counts[p.id] })) });
  } catch (err) {
    console.error("[th-spectate] room", err instanceof Error ? err.message : err);
    return fail(500, "server_error");
  }
}
