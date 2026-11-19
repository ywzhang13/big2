// 十三支開房：POST { hostId, arrangeSec: 15～120 每 15 秒一階, totalHands: 8|16|32, baseScore?: 10～100000 的整數（畫面預設選項 30、50、100、200，沒帶＝100） } → { roomId, code }。要登入；開完房主再呼叫 join 入座
// 開房時順便清閒置太久的十三支房（同麻將：回應送出後才跑，不拖慢開房；規則見 lib/thirteen/server.ts sweepIdleThirteenRooms）
import { randomInt } from "node:crypto";
import { after } from "next/server";
import { getAuthUser } from "@/lib/auth";
import { ARRANGE_SEC_MESSAGE, BASE_SCORE_MESSAGE, DEFAULT_BASE_SCORE, insertRoom, isArrangeSec, isBaseScore, isTotalHands, TOTAL_HANDS_MESSAGE } from "@/lib/thirteen/db";
import { fail, json, sweepIdleThirteenRooms } from "@/lib/thirteen/server";

export async function POST(request: Request) {
  const user = await getAuthUser(request);
  if (!user) return fail(401, "not_logged_in");
  const body = await request.json().catch(() => null) as { hostId?: unknown; arrangeSec?: unknown; totalHands?: unknown; baseScore?: unknown } | null;
  const hostId = body?.hostId, arrangeSec = body?.arrangeSec, totalHands = body?.totalHands;
  if (typeof hostId !== "string" || !hostId || hostId.length > 64) return fail(400, "bad_request");
  if (!isArrangeSec(arrangeSec)) return fail(400, "bad_arrange_sec", ARRANGE_SEC_MESSAGE);
  if (!isTotalHands(totalHands)) return fail(400, "bad_total_hands", TOTAL_HANDS_MESSAGE);
  const baseScore = body && "baseScore" in body ? body.baseScore : DEFAULT_BASE_SCORE;
  if (!isBaseScore(baseScore)) return fail(400, "bad_base_score", BASE_SCORE_MESSAGE);
  try {
    for (let i = 0; i < 10; i++) {
      const code = String(randomInt(0, 10000)).padStart(4, "0");
      const r = await insertRoom({ code, host_id: hostId, host_user_id: user.id, settings: { arrangeSec, totalHands, baseScore, scoreRule: "v4" } });
      if (r !== "duplicate") {
        after(() => sweepIdleThirteenRooms().then(() => undefined));
        return json({ roomId: r.id, code });
      }
    }
    return fail(503, "no_code", "房號用完了，請再試一次");
  } catch (err) {
    return fail(500, "server_error", err instanceof Error ? err.message : "伺服器錯誤");
  }
}
