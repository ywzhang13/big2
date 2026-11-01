// 斗內後台：撤回一批結清。POST { batchId, reason? }（batchId＝結清時回傳的那筆斗內 id）。只有老闆帳號能用。
//   同一批結清的場次全部回到未結清，那筆斗內（含打賞）整筆作廢；寫操作紀錄 match_unsettle。
//   成功 → { batchId, amount, rooms: [{ roomId, roomCode, zimo, due }] }；404 not_found＝沒有這批或已經撤回
import { fail, ok, readBody, requireOwner } from "@/lib/mahjong/zimoFx/admin";
import { unsettleBatch } from "@/lib/mahjong/zimoFx/store";
import { isUuid } from "@/lib/mahjong/spectate/rules";

export async function POST(request: Request) {
  try {
    const owner = await requireOwner(request);
    if (owner instanceof Response) return owner;
    const b = await readBody(request);
    const reason = typeof b?.reason === "string" && b.reason.trim() ? b.reason.trim() : "撤回";
    if (!b || !isUuid(b.batchId) || reason.length > 200) return fail(400, "bad_request");
    const r = await unsettleBatch(owner.id, b.batchId, reason);
    if (!r.ok) return fail(404, "not_found");
    const { ok: _ok, ...body } = r;
    return ok(body);
  } catch (err) {
    console.error("[mj-admin] unsettle", err instanceof Error ? err.message : err);
    return fail(500, "server_error");
  }
}
