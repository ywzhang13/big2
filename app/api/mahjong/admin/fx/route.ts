// 斗內後台：玩家的自摸特效。只有老闆帳號能用。
//   GET ?userId=：這位玩家的開通紀錄（含收回、過期的）、目前有效的特效和到期時間、目前選用
//   POST { userId, fx: [代號...], active: 代號 }：開通（有效到下週日 23:59:59，到期自動失效；老闆 2026-10-31）並指定目前套用；同時寫操作紀錄。
//     斗內和開通是兩個獨立動作，這裡不看金額。老闆自己的帳號 6 種永久全開，不用開通（400 owner_permanent）
import { fail, ok, readBody, requireOwner } from "@/lib/mahjong/zimoFx/admin";
import { GOLDEN_ZIMO_FX, grantExpiresAt, isOwner, isZimoFx } from "@/lib/mahjong/zimoFx/rules";
import { grantFx, lineProfile, nowMs, playerFx } from "@/lib/mahjong/zimoFx/store";

export async function GET(request: Request) {
  try {
    const owner = await requireOwner(request);
    if (owner instanceof Response) return owner;
    const userId = new URL(request.url).searchParams.get("userId");
    if (!userId) return fail(400, "bad_request");
    const now = nowMs();
    const { grants, selected } = await playerFx(userId);
    const active: Record<string, number> = {};
    for (const g of grants) if (!g.revokedAt && g.expiresAt > now) active[g.fx] = Math.max(active[g.fx] ?? 0, g.expiresAt);
    return ok({ serverNow: now, permanent: isOwner(userId), active, selected: selected === GOLDEN_ZIMO_FX || (selected && (isOwner(userId) || active[selected])) ? selected : GOLDEN_ZIMO_FX, grants });
  } catch (err) {
    console.error("[mj-admin] fx", err instanceof Error ? err.message : err);
    return fail(500, "server_error");
  }
}

export async function POST(request: Request) {
  try {
    const owner = await requireOwner(request);
    if (owner instanceof Response) return owner;
    const b = await readBody(request);
    const fx = Array.isArray(b?.fx) ? [...new Set(b.fx)] : [];
    if (!b || typeof b.userId !== "string" || fx.length === 0 || !fx.every(isZimoFx) || !isZimoFx(b.active) || !fx.includes(b.active)) return fail(400, "bad_request");
    if (isOwner(b.userId)) return fail(400, "owner_permanent");
    if (!(await lineProfile(b.userId))) return fail(400, "unknown_player");
    const expiresAt = grantExpiresAt(nowMs());
    const granted = await grantFx(owner.id, b.userId, fx as string[], b.active, expiresAt);
    return ok({ granted, expiresAt });
  } catch (err) {
    console.error("[mj-admin] fx grant", err instanceof Error ? err.message : err);
    return fail(500, "server_error");
  }
}
