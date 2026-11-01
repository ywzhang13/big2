// 歷史紀錄：只回「我」（登入的 LINE 使用者）打過的麻將場次。前端不送任何 id，伺服器用登入身分查。
// GET /api/mahjong/records?limit=20&cursor=<endedAt>|<id>&summary=1
// 每場加上自摸（老闆 2026-11-02）：zimo＝[{ seat, count }]（只列有自摸的座位）、zimoHands＝[{ hand, seat }]（只有自摸的把）、
//   myDue＝我這場 11/1 00:00 之後的自摸 { zimo, due, settled }，沒有就是 null。只有 LINE 帳號的自摸有紀錄（遊客不記）
import { getAuthUser } from "@/lib/auth";
import { notLoggedIn } from "@/lib/mahjong/access";
import { listMyMahjongMatches, summarizeMyMahjong } from "@/lib/records/store";
import { matchZimo, unsettledMatches } from "@/lib/mahjong/zimoFx/store";
import { ZIMO_PRICE } from "@/lib/mahjong/zimoFx/rules";
import type { MyMatch } from "@/lib/records/types";

const CUTOFF = Date.parse("2026-11-01T00:00:00+08:00"); // 11/1 以前的自摸既往不究（老闆 2026-11-02）

/** 每場加上自摸資料，拿掉伺服器內部欄位（房間 id、座位帳號）。自摸查詢失敗不影響列表：照樣回場次，自摸欄位留空 */
async function withZimo(userId: string, items: MyMatch[]) {
  let wins: Awaited<ReturnType<typeof matchZimo>> = [], unsettled: Awaited<ReturnType<typeof unsettledMatches>> = [];
  try {
    [wins, unsettled] = await Promise.all([matchZimo(items.map((m) => m.roomId)), unsettledMatches(userId)]);
  } catch (err) {
    console.error("[records] 自摸資料查詢失敗：", err instanceof Error ? err.message : err);
  }
  const open = new Set(unsettled.map((u) => u.roomId));
  return items.map(({ roomId, seatUserIds, ...m }) => {
    const seatOf = new Map(Object.entries(seatUserIds).filter(([, u]) => u).map(([seat, u]) => [u as string, Number(seat)]));
    const mine = wins.filter((w) => w.roomId === roomId && seatOf.has(w.userId));
    const counts = new Map<number, number>();
    for (const w of mine) counts.set(seatOf.get(w.userId)!, (counts.get(seatOf.get(w.userId)!) ?? 0) + 1);
    const due = mine.filter((w) => w.userId === userId && w.wonAt > CUTOFF).length;
    return {
      ...m,
      zimo: [...counts.entries()].sort(([a], [b]) => a - b).map(([seat, count]) => ({ seat, count })),
      zimoHands: mine.map((w) => ({ hand: w.handNo, seat: seatOf.get(w.userId)! })),
      myDue: due > 0 ? { zimo: due, due: due * ZIMO_PRICE, settled: !open.has(roomId) } : null,
    };
  });
}

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
    const items = await withZimo(user.id, rows.slice(0, limit));
    const last = items[items.length - 1];
    const nextCursor = rows.length > limit && last ? `${last.endedAt}|${last.id}` : null;
    const summary = params.get("summary") === "1" ? await summarizeMyMahjong(user.id) : undefined;
    return Response.json({ items, nextCursor, ...(summary ? { summary } : {}) });
  } catch {
    return Response.json({ error: "載入失敗" }, { status: 500 });
  }
}
