// 房卡規則（純資料，不連任何服務）。規劃 v1 第 2 節、小宜房卡設計說明 v1.2 第 4-5 節（老闆 2026-11-19／20 定案）：
//   ・每人各扣、開局就扣，每次扣 1 張；餘額可以是負數、沒有下限
//   ・麻將：每一把開局扣；連莊那把（roundInfo.dealerConsecutive > 0）不扣。四圈沒連莊＝每人 16 張
//   ・十三支：奇數局（第 1、3、5…局）開局扣、偶數局不扣。8 局每人 4 張
//   ・大老二：不扣（這裡沒有大老二的規則，大老二的路由也沒有呼叫扣卡）
//   ・老闆帳號（OWNER_USER_ID）不扣；遊客不扣（資料庫函式 room_card_charge 用 auth.users 排除）
import type { MahjongGameState } from "@/lib/mahjong/gameState";
import { isOwner } from "@/lib/mahjong/zimoFx/rules";

export type CardGame = "mahjong" | "thirteen";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** 要扣卡的帳號：LINE 帳號 id（uuid），去掉老闆、重複的；沒綁帳號的舊座位略過 */
export function chargeableUsers(userIds: (string | null | undefined)[]): string[] {
  return [...new Set(userIds.filter((u): u is string => typeof u === "string" && UUID.test(u) && !isOwner(u)))];
}

/**
 * 麻將：剛發好牌的這一把要不要扣、算第幾把。要在「開局就八仙過海」的 applySettlement 之前呼叫（它會把打完的把數 +1）。
 * 第幾把＝打完的把數＋1：連莊的把也算一把，所以每一把的號碼都不同（同一房同一把只會扣一次）。連莊回 null
 */
export function mahjongChargeHand(s: Pick<MahjongGameState, "roundInfo" | "handsCompleted">): number | null {
  if ((s.roundInfo?.dealerConsecutive ?? 0) > 0) return null;
  return (s.handsCompleted ?? 0) + 1;
}

/** 十三支：第 handNo 局（從 1 開始）開局要不要扣。奇數局扣 */
export const thirteenChargesHand = (handNo: number) => Number.isInteger(handNo) && handNo >= 1 && handNo % 2 === 1;

/** 後台寫入的張數：1～100000 的整數 */
export const isCardCount = (x: unknown): x is number => Number.isInteger(x) && (x as number) >= 1 && (x as number) <= 100000;
export const isUuid = (x: unknown): x is string => typeof x === "string" && UUID.test(x);

const TPE_OFFSET_MS = 8 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
/** 台北時間今天 00:00 的 epoch 毫秒（後台「今天扣卡」） */
export function taipeiDayStart(now: number): number {
  const local = now + TPE_OFFSET_MS;
  return local - (((local % DAY_MS) + DAY_MS) % DAY_MS) - TPE_OFFSET_MS;
}

/** 全部流水帳的期間：今天／本週（週一起）／本月（1 號起），台北時間；all＝全部期間（null） */
export type FeedPeriod = "today" | "week" | "month" | "all";
export const isFeedPeriod = (x: unknown): x is FeedPeriod => x === "today" || x === "week" || x === "month" || x === "all";
export function periodStart(period: FeedPeriod, now: number): number | null {
  if (period === "all") return null;
  const day = taipeiDayStart(now);
  if (period === "today") return day;
  const local = new Date(day + TPE_OFFSET_MS); // 當成 UTC 看就是台北的日期
  if (period === "week") return day - ((local.getUTCDay() + 6) % 7) * DAY_MS; // 週一＝0
  return Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), 1) - TPE_OFFSET_MS;
}

/** 流水帳的「操作人」分類：system＝扣卡、owner＝老闆在後台操作、donate_debt＝上線時斗內欠款轉房卡（老柯 2026-11-20 補扣）、other＝其他 */
export const DONATE_DEBT_ACTOR = "斗內欠款轉房卡";
export type ActorKind = "system" | "owner" | "donate_debt" | "other";
export function actorKind(actor: string, ownerId: string): ActorKind {
  if (actor === "system") return "system";
  if (actor === ownerId) return "owner";
  if (actor === DONATE_DEBT_ACTOR) return "donate_debt";
  return "other";
}
