// 斗內後台：作廢一筆斗內（不能刪除、不能改原值）。POST { id, reason }。只有老闆帳號能用；同時寫操作紀錄
import { fail, ok, readBody, requireOwner } from "@/lib/mahjong/zimoFx/admin";
import { voidDonation } from "@/lib/mahjong/zimoFx/store";
import { isUuid } from "@/lib/mahjong/spectate/rules";

export async function POST(request: Request) {
  try {
    const owner = await requireOwner(request);
    if (owner instanceof Response) return owner;
    const b = await readBody(request);
    const reason = typeof b?.reason === "string" ? b.reason.trim() : "";
    if (!b || !isUuid(b.id) || reason.length < 1 || reason.length > 200) return fail(400, "bad_request");
    if (!(await voidDonation(owner.id, b.id, reason))) return fail(409, "not_voidable"); // 沒有這筆或已經作廢
    return ok({ voided: true });
  } catch (err) {
    console.error("[mj-admin] donation void", err instanceof Error ? err.message : err);
    return fail(500, "server_error");
  }
}
