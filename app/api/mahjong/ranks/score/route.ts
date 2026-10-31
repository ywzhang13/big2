// 公開麻將輸贏排行榜。GET ?range=week（預設）|all
//   week：本週（台北時間週一 00:00～週日 23:59:59，和斗內榜同一個週），看場次的結束時間；all：總輸贏
//   一場打完或中途解散才進榜（還在打的不算）。淨分和玩家「歷史紀錄」頁的累計同一個算法
//   不用登入；有帶 LINE 登入的 token 時，自己那列 me=true。每列只有名次、名稱、頭像、分數、me，不含帳號 id
import { getAuthUser } from "@/lib/auth";
import { scoreBoard } from "@/lib/records/scoreBoard";
import { lineBoardAccounts, listMahjongScores, nowMs } from "@/lib/records/store";
import { weekOf } from "@/lib/mahjong/zimoFx/rules";

const noStore = { "cache-control": "no-store" };

export async function GET(request: Request) {
  try {
    const range = new URL(request.url).searchParams.get("range") ?? "week";
    if (range !== "week" && range !== "all") return Response.json({ error: "bad_request" }, { status: 400, headers: noStore });
    const now = nowMs(), week = weekOf(now);
    const [user, scores] = await Promise.all([getAuthUser(request), listMahjongScores(range === "week" ? { from: week.start, to: week.end } : undefined)]);
    const accounts = await lineBoardAccounts([...new Set(scores.map((s) => s.userId))]);
    const rows = scoreBoard(scores, accounts, user && !user.isGuest ? user.id : null);
    return Response.json({ serverNow: now, range, ...(range === "week" ? { weekStart: week.start, weekEnd: week.end } : {}), rows }, { headers: noStore });
  } catch (err) {
    console.error("[mj-ranks] score", err instanceof Error ? err.message : err);
    return Response.json({ error: "server_error" }, { status: 500, headers: noStore });
  }
}
