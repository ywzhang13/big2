// 斗內後台：斗內紀錄。只有老闆帳號能用。
//   GET ?scope=week（預設，本週）|all：列出紀錄（含作廢的，作廢的有 voidedAt、voidReason）和本週有效合計
//   POST { userId, amount, donatedAt, note? }：記一筆打賞（不開通特效、不結清任何場次；同時寫操作紀錄）→ { id, tip }
//     以場結清上線後（老闆 2026-11-02）：結清改在「未結清」按已收（/admin/settlements），這裡只記錢，不再自動抵扣
import { fail, ok, readBody, requireOwner } from "@/lib/mahjong/zimoFx/admin";
import { weekOf } from "@/lib/mahjong/zimoFx/rules";
import { addTip, lineProfile, listDonations, nowMs } from "@/lib/mahjong/zimoFx/store";

export async function GET(request: Request) {
  try {
    const owner = await requireOwner(request);
    if (owner instanceof Response) return owner;
    const scope = new URL(request.url).searchParams.get("scope") ?? "week";
    if (scope !== "week" && scope !== "all") return fail(400, "bad_request");
    const now = nowMs(), week = weekOf(now);
    const records = await listDonations(scope === "week" ? { from: week.start, to: week.end } : undefined);
    const weekTotal = records.filter((r) => !r.voided && r.donatedAt >= week.start && r.donatedAt < week.end).reduce((a, r) => a + r.amount, 0);
    return ok({ serverNow: now, weekStart: week.start, weekEnd: week.end, weekTotal, records });
  } catch (err) {
    console.error("[mj-admin] donations", err instanceof Error ? err.message : err);
    return fail(500, "server_error");
  }
}

export async function POST(request: Request) {
  try {
    const owner = await requireOwner(request);
    if (owner instanceof Response) return owner;
    const b = await readBody(request);
    const now = nowMs();
    const donatedAt = typeof b?.donatedAt === "string" ? Date.parse(b.donatedAt) : NaN;
    const note = b?.note ?? "";
    if (!b || typeof b.userId !== "string" || !Number.isInteger(b.amount) || (b.amount as number) < 1 || (b.amount as number) > 999999
      || !Number.isFinite(donatedAt) || donatedAt > now + 5 * 60 * 1000 || typeof note !== "string" || note.length > 200) return fail(400, "bad_request");
    const profile = await lineProfile(b.userId);
    if (!profile) return fail(400, "unknown_player");
    const id = await addTip(owner.id, { userId: b.userId, name: profile.name, avatarUrl: profile.avatarUrl, amount: b.amount as number, donatedAt, note });
    return ok({ id, tip: b.amount });
  } catch (err) {
    console.error("[mj-admin] donation add", err instanceof Error ? err.message : err);
    return fail(500, "server_error");
  }
}
