// 公開斗內排行榜。GET ?range=week（預設）|all
//   week：本週榜，只排本週（台北時間週一 00:00～週日 23:59:59）的有效斗內，每週一自然從 0 開始
//   all：總斗內，累計所有有效斗內、不分週（老闆 2026-10-31）
// 作廢的都不算。不用登入。每列只有名次、LINE 名稱、頭像、金額（最新一筆有效斗內記帳時存的）、me，不含任何帳號 id
//   有帶 LINE 登入的 token 時，自己那列 me=true（2026-10-31，和輸贏榜一致）；沒登入、遊客全部 false
import { getAuthUser } from "@/lib/auth";
import { allTimeBoard, weeklyBoard, weekOf } from "@/lib/mahjong/zimoFx/rules";
import { listDonations, nowMs } from "@/lib/mahjong/zimoFx/store";

const noStore = { "cache-control": "no-store" };

export async function GET(request: Request) {
  try {
    const range = new URL(request.url).searchParams.get("range") ?? "week";
    if (range !== "week" && range !== "all") return Response.json({ error: "bad_request" }, { status: 400, headers: noStore });
    const now = nowMs(), week = weekOf(now);
    const [user, donations] = await Promise.all([getAuthUser(request), listDonations(range === "week" ? { from: week.start, to: week.end } : undefined)]);
    const meId = user && !user.isGuest ? user.id : null;
    if (range === "all") return Response.json({ serverNow: now, range, rows: allTimeBoard(donations, meId) }, { headers: noStore });
    const rows = weeklyBoard(donations, now, meId);
    return Response.json({ serverNow: now, range, weekStart: week.start, weekEnd: week.end, rows }, { headers: noStore });
  } catch (err) {
    console.error("[mj-donations] leaderboard", err instanceof Error ? err.message : err);
    return Response.json({ error: "server_error" }, { status: 500 });
  }
}
