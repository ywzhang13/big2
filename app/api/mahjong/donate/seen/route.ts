// 看過斗內卡（收起）：POST /api/mahjong/donate/seen { count } → { count, show: false }
// 記下「看過幾次」＝max(原本, min(body.count, 目前次數))：看卡時剛好又自摸，沒看過的那次不會被吃掉。不改次數（歸零只有老闆能做）。
// 沒登入 401；訪客不計數，回 { count: 0, show: false }；count 不是 0 以上的整數 400。
import { getAuthUser } from "@/lib/auth";
import { markSeen } from "@/lib/mahjong/donate/store";

export async function POST(request: Request) {
  const user = await getAuthUser(request);
  if (!user) return Response.json({ error: "not_logged_in" }, { status: 401 });
  if (user.isGuest) return Response.json({ count: 0, show: false });
  const body = (await request.json().catch(() => null)) as { count?: unknown } | null;
  const count = body?.count;
  if (typeof count !== "number" || !Number.isInteger(count) || count < 0 || count > 100000) return Response.json({ error: "bad_request" }, { status: 400 });
  try {
    const s = await markSeen(user.id, count);
    return Response.json({ count: s.count, show: s.count > s.seen });
  } catch (err) {
    console.error("[mj-donate] seen", err instanceof Error ? err.message : err);
    return Response.json({ error: "server_error" }, { status: 500 });
  }
}
