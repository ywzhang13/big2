// 房卡後台的寫入（充值、回收、暫停、恢復）。只有老闆帳號能用；每次都要帶操作編號 opId（uuid），重送同一個只生效一次。
import { fail, ok, readBody, requireOwner, targetUser } from "./admin";
import { isCardCount, isUuid } from "./rules";
import { reclaim, setSuspended, topup } from "@/lib/roomCard/store";

export async function adjust(request: Request, kind: "topup" | "reclaim"): Promise<Response> {
  try {
    const owner = await requireOwner(request);
    if (owner instanceof Response) return owner;
    const b = await readBody(request);
    if (!b || !isCardCount(b.cards) || !isUuid(b.opId)) return fail(400, "bad_request");
    const user = await targetUser(b.userId);
    if (user instanceof Response) return user;
    const r = await (kind === "topup" ? topup : reclaim)(owner.id, user.userId, b.cards, b.opId);
    if (!r.ok) return fail(409, r.error);
    return ok({ userId: user.userId, balance: r.balance, replay: r.replay });
  } catch (err) {
    console.error(`[room-card-admin] ${kind}`, err instanceof Error ? err.message : err);
    return fail(500, "server_error");
  }
}

export async function setSuspension(request: Request, suspend: boolean): Promise<Response> {
  try {
    const owner = await requireOwner(request);
    if (owner instanceof Response) return owner;
    const b = await readBody(request);
    if (!b || !isUuid(b.opId)) return fail(400, "bad_request");
    const user = await targetUser(b.userId);
    if (user instanceof Response) return user;
    const r = await setSuspended(owner.id, user.userId, suspend, b.opId);
    if (!r.ok) return fail(409, r.error);
    return ok({ userId: user.userId, suspended: r.suspendedAt !== null, suspendedAt: r.suspendedAt, replay: r.replay });
  } catch (err) {
    console.error(`[room-card-admin] ${suspend ? "suspend" : "resume"}`, err instanceof Error ? err.message : err);
    return fail(500, "server_error");
  }
}
