// 斗內下架（老柯 2026-11-20）：POST 預設停用、回 410 donate_disabled（lib/mahjong/donate/off.ts）；MJ_DONATE_WRITES=1 才照下面原本的說明寫入
// 斗內後台：作廢一筆斗內（不能刪除、不能改原值）。POST { id, reason }。只有老闆帳號能用；同時寫操作紀錄
import { fail, ok, readBody, requireOwner } from "@/lib/mahjong/zimoFx/admin";
import { voidDonation } from "@/lib/mahjong/zimoFx/store";
import { isUuid } from "@/lib/mahjong/spectate/rules";
import { unlessDonateDisabled } from "@/lib/mahjong/donate/off";

export const POST = unlessDonateDisabled(async function POST(request: Request) {
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
});
