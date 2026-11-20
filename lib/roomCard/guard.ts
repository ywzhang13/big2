// 暫停的人不能開新房、不能加入新房；房裡有人被暫停就不能開局（小宜房卡設計說明 v1.2 第 2-4、2-5、2-6 節）。
// 正在打的那一場不擋：重新加入自己原本的座位、下一局、送出、解散都不經過這裡，照常打完、照常扣卡。
// 查詢失敗就丟錯（路由回 500），不放行：房卡帳和牌局在同一個資料庫，查不到時本來也開不了房。
import { isOwner } from "@/lib/mahjong/zimoFx/rules";
import { accounts } from "@/lib/roomCard/store";
import { isUuid } from "./rules";

const body = (status: number, b: object) => Response.json(b, { status, headers: { "cache-control": "no-store" } });

/** 這個帳號被暫停了 → 403 { error: "suspended", message, suspendedAt }；沒暫停（或老闆、遊客沒有帳戶）→ null */
export async function suspendedError(userId: string): Promise<Response | null> {
  if (isOwner(userId) || !isUuid(userId)) return null; // 不是 LINE 帳號 id（舊資料、測試的假帳號）不會有房卡帳戶
  const a = (await accounts([userId])).get(userId);
  if (!a?.suspendedAt) return null;
  return body(403, { error: "suspended", message: "帳號已暫停", suspendedAt: a.suspendedAt });
}

/** 開局前：房裡有人被暫停 → 403 { error: "player_suspended", message, players: [{ seat, name }] }；都沒有 → null */
export async function startBlockedError(seats: { userId: string | null; name: string; seat: number }[]): Promise<Response | null> {
  const ids = seats.map((p) => p.userId).filter((u): u is string => isUuid(u) && !isOwner(u));
  const acc = await accounts([...new Set(ids)]);
  const blocked = seats.filter((p) => p.userId && acc.get(p.userId)?.suspendedAt).map((p) => ({ seat: p.seat, name: p.name }));
  if (blocked.length === 0) return null;
  return body(403, { error: "player_suspended", message: "房裡有人帳號已暫停，不能開局", players: blocked });
}
