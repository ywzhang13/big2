// 房卡後台：單一玩家明細和流水帳。GET ?userId= → { player, entries: [...] }（新的在前；同一房的扣卡收成一筆，hands 是第幾把）
// 只有老闆帳號能用；老闆自己 400 owner_exempt、不是 LINE 帳號 400 unknown_player
import { fail, ok, requireOwner, targetUser } from "@/lib/roomCard/admin";
import { playerHistory } from "@/lib/roomCard/admin-read";

export async function GET(request: Request) {
  try {
    const owner = await requireOwner(request);
    if (owner instanceof Response) return owner;
    const user = await targetUser(new URL(request.url).searchParams.get("userId"));
    if (user instanceof Response) return user;
    return ok(await playerHistory(user));
  } catch (err) {
    console.error("[room-card-admin] ledger", err instanceof Error ? err.message : err);
    return fail(500, "server_error");
  }
}
