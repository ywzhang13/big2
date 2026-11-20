// 房卡後台：玩家名單。GET → { serverNow, stats: { players, debtors, debtCards, suspended, chargedToday }, players: [...] }
// 只有老闆帳號能用。名單＝所有 LINE 登入帳號（不含老闆、遊客），照餘額由少到多（欠最多的在最上面）；
// 欠卡名單＝前端篩 balance < 0；搜尋＝前端篩名字或 shortId（人數少，一次給全部）
import { fail, ok, requireOwner } from "@/lib/roomCard/admin";
import { playerList } from "@/lib/roomCard/admin-read";

export async function GET(request: Request) {
  try {
    const owner = await requireOwner(request);
    if (owner instanceof Response) return owner;
    return ok(await playerList());
  } catch (err) {
    console.error("[room-card-admin] players", err instanceof Error ? err.message : err);
    return fail(500, "server_error");
  }
}
