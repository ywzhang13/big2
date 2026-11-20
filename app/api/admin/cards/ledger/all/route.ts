// 房卡後台：全部流水帳（老柯 2026-11-20，第二批；小宜房卡設計說明 v1.2 第 4-4 節）。只有老闆帳號能用（沒登入 401、其他人 403）。
// GET ?kind=topup|charge|reclaim|suspend|resume（不給＝全部）&period=today|week|month|all（不給＝all，台北時間）&limit=1～100（預設 50）&cursor=<上一頁的 nextCursor>
// → { serverNow, period, kind, stats: { topup, charge, reclaim }, entries: [...], nextCursor }
//   entries 新到舊；每一筆：kind、at、玩家（userId、shortId、name、avatarUrl）、cards（充值正、扣卡和回收負、暫停恢復 null）、balanceAfter、
//   扣卡的 game、roomCode、handNo；actor 和 actorKind（system 扣卡／owner 老闆操作／donate_debt 上線時「斗內欠款轉房卡」／other）
//   stats＝這段期間（不看 kind）充值、扣卡、回收各幾張（正數）。老闆帳號的資料不出現。
import { fail, ok, requireOwner } from "@/lib/roomCard/admin";
import { decodeCursor, ledgerFeed } from "@/lib/roomCard/admin-read";
import { isFeedPeriod } from "@/lib/roomCard/rules";
import type { FeedKind } from "@/lib/roomCard/store";

const KINDS: readonly FeedKind[] = ["topup", "charge", "reclaim", "suspend", "resume"];
const isKind = (x: unknown): x is FeedKind => (KINDS as readonly unknown[]).includes(x);

export async function GET(request: Request) {
  try {
    const owner = await requireOwner(request);
    if (owner instanceof Response) return owner;
    const q = new URL(request.url).searchParams;
    const kind = q.get("kind"), period = q.get("period") ?? "all", rawLimit = q.get("limit");
    const limit = rawLimit === null ? 50 : Number(rawLimit);
    const cursor = decodeCursor(q.get("cursor"));
    if ((kind !== null && !isKind(kind)) || !isFeedPeriod(period) || !Number.isInteger(limit) || limit < 1 || limit > 100 || cursor === undefined)
      return fail(400, "bad_request");
    return ok(await ledgerFeed({ kind: kind as FeedKind | null, period, limit, cursor }));
  } catch (err) {
    console.error("[room-card-admin] ledger/all", err instanceof Error ? err.message : err);
    return fail(500, "server_error");
  }
}
