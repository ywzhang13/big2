// 玩家自己的自摸特效。要 LINE 登入（遊客 403）。
//   GET：金色自摸（全帳號永久）＋已開通、還在有效期的特效（代號→到期時間，null＝永久；有開通就 6 種全開；老闆帳號 6 種永久）和目前選用
//   POST { fx }：金色自摸或已開通的特效可套用（同時寫操作紀錄）；沒開通、過期、被收回 403 not_granted，
//     不會改到原本的選用，回應附上目前實際套用的 selected（前端照這個顯示，不要留在被拒的那一種）
import { getAuthUser } from "@/lib/auth";
import { fail, ok, readBody } from "@/lib/mahjong/zimoFx/admin";
import { GOLDEN_ZIMO_FX, isOwner, isSelectableZimoFx, ZIMO_FX } from "@/lib/mahjong/zimoFx/rules";
import { nowMs, playerFx, selectFx } from "@/lib/mahjong/zimoFx/store";

async function available(userId: string, now: number): Promise<{ fx: Record<string, number | null>; selected: string | null }> {
  const { grants, selected } = await playerFx(userId);
  const fx: Record<string, number | null> = { [GOLDEN_ZIMO_FX]: null };
  if (isOwner(userId)) for (const c of ZIMO_FX) fx[c] = null;
  else {
    // 一次全開（老闆 2026-11-02）：有任何一筆還有效的開通，6 種都能用，到期時間取最晚的；永久開通（2026-11-04）＝null，和老闆帳號一樣
    const until = Math.max(0, ...grants.filter((g) => !g.revokedAt && g.expiresAt > now).map((g) => g.expiresAt));
    if (until > 0) for (const c of ZIMO_FX) fx[c] = until === Infinity ? null : until;
  }
  const sel = selected && selected in fx ? selected : GOLDEN_ZIMO_FX;
  return { fx, selected: sel };
}

export async function GET(request: Request) {
  try {
    const user = await getAuthUser(request);
    if (!user) return fail(401, "not_logged_in");
    if (user.isGuest) return fail(403, "guest_not_allowed");
    const now = nowMs();
    const a = await available(user.id, now);
    return ok({ serverNow: now, displayName: user.displayName ?? "LINE 使用者", isOwner: isOwner(user.id), available: a.fx, selected: a.selected });
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
    if (!(await selectFx(user.id, b.fx, isOwner(user.id)))) return fail(403, "not_granted", { selected: (await available(user.id, nowMs())).selected });
    return ok({ selected: b.fx });
  } catch (err) {
    console.error("[mj-zimo-fx] post", err instanceof Error ? err.message : err);
    return fail(500, "server_error");
  }
}
