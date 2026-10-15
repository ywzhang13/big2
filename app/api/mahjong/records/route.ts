// 歷史紀錄：只回「我」（登入的 LINE 使用者）打過的麻將場次。前端不送任何 id，伺服器用登入身分查。
// GET /api/mahjong/records?limit=20&cursor=<endedAt>|<id>&summary=1
import { getAuthUser } from "@/lib/auth";
import { notLoggedIn } from "@/lib/mahjong/access";
import { listMyMahjongMatches, summarizeMyMahjong } from "@/lib/records/store";

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;
const ISO_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?(Z|[+-]\d{2}:\d{2})$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(request: Request) {
  const user = await getAuthUser(request);
  if (!user) return notLoggedIn();

  const params = new URL(request.url).searchParams;
  const n = parseInt(params.get("limit") ?? "", 10);
  const limit = Number.isFinite(n) && n > 0 ? Math.min(n, MAX_LIMIT) : DEFAULT_LIMIT;

  let cursor: { endedAt: string; id: string } | null = null;
  const rawCursor = params.get("cursor");
  if (rawCursor) {
    const [endedAt, id] = rawCursor.split("|");
    // 只接受「ISO 時間|uuid」（就是上一頁回傳的 nextCursor），避免把任意字串拼進查詢條件
    if (!ISO_TIME.test(endedAt ?? "") || !UUID.test(id ?? "")) {
      return Response.json({ error: "cursor 格式錯誤" }, { status: 400 });
    }
    cursor = { endedAt, id };
  }

  try {
    // 多拿一筆判斷還有沒有下一頁
    const rows = await listMyMahjongMatches(user.id, limit + 1, cursor);
    const items = rows.slice(0, limit);
    const last = items[items.length - 1];
    const nextCursor = rows.length > limit && last ? `${last.endedAt}|${last.id}` : null;
    const summary = params.get("summary") === "1" ? await summarizeMyMahjong(user.id) : undefined;
    return Response.json({ items, nextCursor, ...(summary ? { summary } : {}) });
  } catch {
    return Response.json({ error: "載入失敗" }, { status: 500 });
  }
}
