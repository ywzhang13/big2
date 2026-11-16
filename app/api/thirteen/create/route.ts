// 十三支開房：POST { hostId, arrangeSec: 30|45|60, totalHands } → { roomId, code }。要登入；開完房主再呼叫 join 入座
import { randomInt } from "node:crypto";
import { getAuthUser } from "@/lib/auth";
import { insertRoom, isArrangeSec } from "@/lib/thirteen/db";
import { fail, json } from "@/lib/thirteen/server";

const MAX_HANDS = 16;

export async function POST(request: Request) {
  const user = await getAuthUser(request);
  if (!user) return fail(401, "not_logged_in");
  const body = await request.json().catch(() => null) as { hostId?: unknown; arrangeSec?: unknown; totalHands?: unknown } | null;
  const hostId = body?.hostId, arrangeSec = body?.arrangeSec, totalHands = body?.totalHands;
  if (typeof hostId !== "string" || !hostId || hostId.length > 64) return fail(400, "bad_request");
  if (!isArrangeSec(arrangeSec)) return fail(400, "bad_arrange_sec", "理牌時間只能是 30、45 或 60 秒");
  if (!Number.isInteger(totalHands) || (totalHands as number) < 1 || (totalHands as number) > MAX_HANDS) return fail(400, "bad_total_hands", `局數要是 1～${MAX_HANDS}`);
  try {
    for (let i = 0; i < 10; i++) {
      const code = String(randomInt(0, 10000)).padStart(4, "0");
      const r = await insertRoom({ code, host_id: hostId, host_user_id: user.id, settings: { arrangeSec, totalHands: totalHands as number } });
      if (r !== "duplicate") return json({ roomId: r.id, code });
    }
    return fail(503, "no_code", "房號用完了，請再試一次");
  } catch (err) {
    return fail(500, "server_error", err instanceof Error ? err.message : "伺服器錯誤");
  }
}
