// 斗內後台：玩家的自摸特效。只有老闆帳號能用。
//   GET ?userId=：這位玩家的開通紀錄（含收回、過期的）、目前有效的特效和到期時間、目前選用
//   POST { userId, active? }：開通全部 6 種（老闆 2026-11-02：一次全開；有效到下週日 23:59:59，到期自動失效）；同時寫操作紀錄。
//     active＝要順便套用的特效（不給＝不改玩家目前的選擇，例如延長）；舊前端送的 fx 清單照樣接受，但一律開全部
//     斗內和開通是兩個獨立動作，這裡不看金額。老闆自己的帳號 6 種永久全開，不用開通（400 owner_permanent）
import { fail, ok, readBody, requireOwner } from "@/lib/mahjong/zimoFx/admin";
import { GOLDEN_ZIMO_FX, grantExpiresAt, isOwner, isZimoFx, ZIMO_FX } from "@/lib/mahjong/zimoFx/rules";
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
    const until = Math.max(0, ...grants.filter((g) => !g.revokedAt && g.expiresAt > now).map((g) => g.expiresAt));
    if (until > 0) for (const c of ZIMO_FX) active[c] = until; // 一次全開：有任何有效開通，6 種都有效
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
    const activeFx = b?.active ?? null;
    const fx = b?.fx === undefined ? null : Array.isArray(b.fx) ? [...new Set(b.fx)] : []; // 舊格式：清單照樣檢查，但一律開全部
    if (!b || typeof b.userId !== "string" || (activeFx !== null && !isZimoFx(activeFx))
      || (fx !== null && (fx.length === 0 || !fx.every(isZimoFx) || (activeFx !== null && !fx.includes(activeFx))))) return fail(400, "bad_request");
    if (isOwner(b.userId)) return fail(400, "owner_permanent");
    if (!(await lineProfile(b.userId))) return fail(400, "unknown_player");
    const expiresAt = grantExpiresAt(nowMs());
    const granted = await grantFx(owner.id, b.userId, [...ZIMO_FX], activeFx as string | null, expiresAt);
    return ok({ granted, expiresAt });
  } catch (err) {
    console.error("[mj-admin] fx grant", err instanceof Error ? err.message : err);
    return fail(500, "server_error");
  }
}
