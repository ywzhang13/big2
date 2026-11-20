// 玩家自己的自摸特效。要 LINE 登入（遊客 403）。
// 自摸特效全開（老柯 2026-11-20，規劃 v1 第 2 節第 6 點）：6 種自摸特效所有 LINE 帳號永久可用，不再看開通紀錄；老闆專屬特效照舊只有老闆。
// 以下是全開之前的說明，「開通」那幾句已不適用：
//   GET：金色自摸（全帳號永久）＋已開通、還在有效期的特效（代號→到期時間，null＝永久；有開通就 6 種全開；老闆帳號 6 種永久）和目前選用
//   POST { fx }：金色自摸或已開通的特效可套用（同時寫操作紀錄）；沒開通、過期、被收回 403 not_granted，
//     不會改到原本的選用，回應附上目前實際套用的 selected（前端照這個顯示，不要留在被拒的那一種）
//   老闆專屬特效（OWNER_FX）：GET 只有老闆的回應帶 ownerFx，available 也只有老闆有；其他人 POST 一樣 403 not_granted，就算有開通也不行
import { getAuthUser } from "@/lib/auth";
import { fail, ok, readBody } from "@/lib/mahjong/zimoFx/admin";
import { GOLDEN_ZIMO_FX, isOwner, isOwnerFx, isSelectableZimoFx, OWNER_FX, ZIMO_FX } from "@/lib/mahjong/zimoFx/rules";
import { nowMs, playerFx, selectFx } from "@/lib/mahjong/zimoFx/store";

async function available(userId: string): Promise<{ fx: Record<string, number | null>; selected: string | null }> {
  const { selected } = await playerFx(userId);
  const fx: Record<string, number | null> = { [GOLDEN_ZIMO_FX]: null };
  for (const c of isOwner(userId) ? [...ZIMO_FX, ...OWNER_FX] : ZIMO_FX) fx[c] = null; // 全部永久（null）
  const sel = selected && selected in fx ? selected : GOLDEN_ZIMO_FX;
  return { fx, selected: sel };
}

export async function GET(request: Request) {
  try {
    const user = await getAuthUser(request);
    if (!user) return fail(401, "not_logged_in");
    if (user.isGuest) return fail(403, "guest_not_allowed");
    const now = nowMs();
    const a = await available(user.id);
    return ok({ serverNow: now, displayName: user.displayName ?? "LINE 使用者", isOwner: isOwner(user.id), ...(isOwner(user.id) ? { ownerFx: OWNER_FX } : {}), available: a.fx, selected: a.selected });
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
    if (!b || !isSelectableZimoFx(b.fx)) return fail(400, "bad_request");
    // 全開：不用查開通（permanent＝true 讓資料庫 mj_fx_select 不檢查開通紀錄）；老闆專屬特效只有老闆能選
    const allowed = (!isOwnerFx(b.fx) || isOwner(user.id)) && (await selectFx(user.id, b.fx, true));
    if (!allowed) return fail(403, "not_granted", { selected: (await available(user.id)).selected });
    return ok({ selected: b.fx });
  } catch (err) {
    console.error("[mj-zimo-fx] post", err instanceof Error ? err.message : err);
    return fail(500, "server_error");
  }
}
