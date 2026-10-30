// 斗內後台：操作紀錄（記帳、作廢、開通、收回、玩家換特效；不能改、不能刪）。GET ?limit=（預設 200，最多 1000）。只有老闆帳號能用
import { fail, ok, requireOwner } from "@/lib/mahjong/zimoFx/admin";
import { listAudit } from "@/lib/mahjong/zimoFx/store";

export async function GET(request: Request) {
  try {
    const owner = await requireOwner(request);
    if (owner instanceof Response) return owner;
    const limit = Number(new URL(request.url).searchParams.get("limit") ?? 200);
    if (!Number.isInteger(limit) || limit < 1 || limit > 1000) return fail(400, "bad_request");
    return ok({ records: await listAudit(limit) });
  } catch (err) {
    console.error("[mj-admin] audit", err instanceof Error ? err.message : err);
    return fail(500, "server_error");
  }
}
