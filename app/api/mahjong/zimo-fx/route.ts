// 玩家自己的自摸特效。要 LINE 登入（遊客 403）。
//   GET：已開通、還在有效期的特效（代號→到期時間；老闆帳號 6 種永久，到期是 null）和目前選用
//   POST { fx }：在可用的特效裡選一種套用（同時寫操作紀錄）；沒開通、過期、被收回 403 not_granted
import { getAuthUser } from "@/lib/auth";
import { fail, ok, readBody } from "@/lib/mahjong/zimoFx/admin";
import { isOwner, isZimoFx, ZIMO_FX } from "@/lib/mahjong/zimoFx/rules";
import { nowMs, playerFx, selectFx } from "@/lib/mahjong/zimoFx/store";

async function available(userId: string, now: number): Promise<{ fx: Record<string, number | null>; selected: string | null }> {
  const { grants, selected } = await playerFx(userId);
  const fx: Record<string, number | null> = {};
  if (isOwner(userId)) for (const c of ZIMO_FX) fx[c] = null;
  else for (const g of grants) if (!g.revokedAt && g.expiresAt > now) fx[g.fx] = Math.max((fx[g.fx] as number) ?? 0, g.expiresAt);
  const sel = selected && selected in fx ? selected : isOwner(userId) ? "meteor" : null;
  return { fx, selected: sel };
}

export async function GET(request: Request) {
  try {
    const user = await getAuthUser(request);
    if (!user) return fail(401, "not_logged_in");
    if (user.isGuest) return fail(403, "guest_not_allowed");
    const now = nowMs();
    const a = await available(user.id, now);
    return ok({ serverNow: now, available: a.fx, selected: a.selected });
  } catch (err) {
    console.error("[mj-zimo-fx] get", err instanceof Error ? err.message : err);
    return fail(500, "server_error");
  }
}

export async function POST(request: Request) {
  try {
    const user = await getAuthUser(request);
    if (!user) return fail(401, "not_logged_in");
    if (user.isGuest) return fail(403, "guest_not_allowed");
    const b = await readBody(request);
    if (!b || !isZimoFx(b.fx)) return fail(400, "bad_request");
    if (!(await selectFx(user.id, b.fx, isOwner(user.id)))) return fail(403, "not_granted");
    return ok({ selected: b.fx });
  } catch (err) {
    console.error("[mj-zimo-fx] post", err instanceof Error ? err.message : err);
    return fail(500, "server_error");
  }
}
