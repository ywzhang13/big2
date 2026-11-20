// 總大廳的歷史紀錄（老柯 2026-11-20，第二批；規劃 v1 第 3 節、小宜房卡設計說明 v1.2 第 3 節）。要登入（沒登入 401）。
// GET /api/records?game=all|mahjong|thirteen|big2（不給＝all）&limit=1～50（預設 20）&cursor=<上一頁的 nextCursor>
// → { items, nextCursor, counts: { all, mahjong, thirteen, big2 }, summary: { matches, totalScore } }
//   只回「我」有入座的場次（伺服器用登入身分查，前端不送任何 id），結束時間新到舊。
//   每場：id、game、roomCode、endedAt、endReason（completed／dissolved）、totalRounds（麻將圈數）、totalHands（十三支局數）、
//   handsPlayed（實際打了幾把／幾局）、myScore、players（四家名字、分數、isMe，不含帳號 id）。不回房卡。
//   counts＝四個頁籤各幾場（all＝三款加總）；summary.totalScore 在 all 頁籤是 null（各遊戲分數算法不同，不加總）。
//   大老二的紀錄沒有記帳號，所以大老二一定是 0 場。麻將 /api/mahjong/records、十三支 /api/thirteen/records 照舊。
import { getAuthUser } from "@/lib/auth";
import { isHistoryGame, myMatchHistory } from "@/lib/records/history";
import { isCursorTime } from "@/lib/records/cursorTime";

const DEFAULT_LIMIT = 20, MAX_LIMIT = 50;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "cache-control": "no-store" } });

export async function GET(request: Request) {
  const user = await getAuthUser(request);
  if (!user) return json({ error: "not_logged_in" }, 401);
  const q = new URL(request.url).searchParams;
  const game = q.get("game") ?? "all";
  if (!isHistoryGame(game)) return json({ error: "bad_request" }, 400);
  const rawLimit = q.get("limit");
  const limit = rawLimit === null ? DEFAULT_LIMIT : Number(rawLimit);
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) return json({ error: "bad_request" }, 400);
  let cursor: { endedAt: string; id: string } | null = null;
  const raw = q.get("cursor");
  if (raw) {
    // 恰好兩段「結束時間|場次 id」；時間要是真的存在的日期時間（不存在的日期以前會送進資料庫變成 500）
    const parts = raw.split("|");
    if (parts.length !== 2 || !isCursorTime(parts[0]) || !UUID.test(parts[1])) return json({ error: "bad_cursor" }, 400);
    cursor = { endedAt: parts[0], id: parts[1] };
  }
  try {
    const page = await myMatchHistory(user.id, game, limit + 1, cursor); // 多拿一筆判斷有沒有下一頁
    const items = page.items.slice(0, limit);
    const last = items[items.length - 1];
    return json({ items, nextCursor: page.items.length > limit && last ? `${last.endedAt}|${last.id}` : null, counts: page.counts, summary: page.summary });
  } catch (err) {
    console.error("[records]", err instanceof Error ? err.message : err);
    return json({ error: "server_error" }, 500);
  }
}
