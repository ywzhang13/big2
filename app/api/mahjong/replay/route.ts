// 牌局回放：列出某一場有哪些局可以回放（只回摘要）。說明見 lib/mahjong/replay/API.md。
// GET /api/mahjong/replay?matchId=<對戰紀錄 id>
//   只有那一場實際上桌的 4 人能讀（觀戰者、其他人 403、未登入 401）；整場還沒結束 403 not_finished；
//   整場結束 7 天後 410 expired（附 expiresAt）。打牌當下完全不會呼叫這支。
import { replayAccess } from "@/lib/mahjong/replay/access";
import { listReplayHands } from "@/lib/mahjong/replay/store";

export async function GET(request: Request) {
  const a = await replayAccess(request);
  if (a instanceof Response) return a;
  const { match, matchId } = a;
  try {
    const hands = await listReplayHands(match.roomId);
    return Response.json({
      matchId, roomCode: match.roomCode, endedAt: match.endedAt, expiresAt: match.expiresAt,
      mySeat: match.mySeat, players: match.players,
      hands: hands.map((h) => ({ handNo: h.handNo, recordedAt: h.recordedAt, ...h.summary })),
    });
  } catch (e) {
    console.error("[mj-replay] 回放列表失敗：", e instanceof Error ? e.message : e);
    return Response.json({ error: "server_error" }, { status: 500 });
  }
}
