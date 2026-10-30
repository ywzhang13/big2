// 斗內後台：提前收回特效。POST { userId, fx?: [代號...] }（沒帶 fx＝全部收回）。只有老闆帳號能用；同時寫操作紀錄。
// 收回後下一次胡牌就回到一般自摸浮層（胡牌前會重新查）
import { fail, ok, readBody, requireOwner } from "@/lib/mahjong/zimoFx/admin";
import { isOwner, isZimoFx } from "@/lib/mahjong/zimoFx/rules";
import { revokeFx } from "@/lib/mahjong/zimoFx/store";

export async function POST(request: Request) {
  try {
    const owner = await requireOwner(request);
    if (owner instanceof Response) return owner;
    const b = await readBody(request);
    const fx = b?.fx === undefined || b?.fx === null ? null : Array.isArray(b.fx) ? [...new Set(b.fx)] : undefined;
    if (!b || typeof b.userId !== "string" || fx === undefined || (fx && (fx.length === 0 || !fx.every(isZimoFx)))) return fail(400, "bad_request");
    if (isOwner(b.userId)) return fail(400, "owner_permanent");
    const revoked = await revokeFx(owner.id, b.userId, fx as string[] | null);
    return ok({ revoked });
  } catch (err) {
    console.error("[mj-admin] fx revoke", err instanceof Error ? err.message : err);
    return fail(500, "server_error");
  }
}
