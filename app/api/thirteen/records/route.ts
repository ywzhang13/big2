// GET /api/thirteen/records?limit=20&cursor=<endedAt>|<id>：我（登入身分）打過的十三支場次，新到舊；前端不送任何 id。
// 回 { items, nextCursor, summary: { matches, totalScore } }。每場：房號、結束時間、結束原因（completed／dissolved）、
// 打了幾局、理牌秒數、局數設定、我的分數、四家分數（不含帳號 id）。麻將的 /api/mahjong/records、排行榜不變（只算麻將）。
import { getAuthUser } from "@/lib/auth";
import { listMyThirteenMatches } from "@/lib/thirteen/db";
import { fail, json } from "@/lib/thirteen/server";

const DEFAULT_LIMIT = 20, MAX_LIMIT = 50;
const ISO_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?(Z|[+-]\d{2}:\d{2})$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(request: Request) {
  const user = await getAuthUser(request);
  if (!user) return fail(401, "not_logged_in");
  const q = new URL(request.url).searchParams;
  const n = parseInt(q.get("limit") ?? "", 10);
  const limit = Number.isFinite(n) && n > 0 ? Math.min(n, MAX_LIMIT) : DEFAULT_LIMIT;
  let cursor: { endedAt: string; id: string } | null = null;
  const raw = q.get("cursor");
  if (raw) {
    const [endedAt, id] = raw.split("|");
    if (!ISO_TIME.test(endedAt ?? "") || !UUID.test(id ?? "")) return fail(400, "bad_cursor");
    cursor = { endedAt, id };
  }
  try {
    const { items, summary } = await listMyThirteenMatches(user.id, limit + 1, cursor); // 多拿一筆判斷有沒有下一頁
    const page = items.slice(0, limit);
    const last = page[page.length - 1];
    return json({ items: page, nextCursor: items.length > limit && last ? `${last.endedAt}|${last.id}` : null, summary });
  } catch (err) {
    console.error("[th-records]", err instanceof Error ? err.message : err);
    return fail(500, "server_error");
  }
}
