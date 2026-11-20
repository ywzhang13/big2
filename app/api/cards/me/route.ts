// 玩家自己的房卡：GET → { isOwner, balance, suspended, suspendedAt }。要登入（沒登入 401）。
// 老闆不扣卡（isOwner: true、balance: null，右上角不顯示房卡）；遊客不扣卡（balance: null）。
// 一般玩家沒有房卡帳戶時是 0 張、沒暫停；暫停原因不給玩家（也沒有原因）
import { getAuthUser } from "@/lib/auth";
import { fail, ok } from "@/lib/mahjong/zimoFx/admin";
import { isOwner } from "@/lib/mahjong/zimoFx/rules";
import { accounts } from "@/lib/roomCard/store";

export async function GET(request: Request) {
  try {
    const user = await getAuthUser(request);
    if (!user) return fail(401, "not_logged_in");
    if (isOwner(user.id) || user.isGuest) return ok({ isOwner: isOwner(user.id), balance: null, suspended: false, suspendedAt: null });
    const a = (await accounts([user.id])).get(user.id);
    return ok({ isOwner: false, balance: a?.balance ?? 0, suspended: !!a?.suspendedAt, suspendedAt: a?.suspendedAt ?? null });
  } catch (err) {
    console.error("[room-card] me", err instanceof Error ? err.message : err);
    return fail(500, "server_error");
  }
}
