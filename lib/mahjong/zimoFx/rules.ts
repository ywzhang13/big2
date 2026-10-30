// 自摸特效庫＋斗內的規則（純資料，不連任何服務）。老闆 2026-10-30／31 定案：
//   ・一週＝週一 00:00 到週日 23:59:59（Asia/Taipei，沒有日光節約，固定 UTC+8）
//   ・特效開通有效到開通當週的週日 23:59:59；老闆帳號 6 種永久全開
//   ・排行榜：本週榜只算本週有效（沒作廢）的斗內；總斗內累計所有有效斗內、不分週（老闆 2026-10-31）。
//     顯示 LINE 名稱和頭像（不做匿名），不含帳號 id
import type { WinFx } from "../gameState";

export const ZIMO_FX: readonly WinFx[] = ["meteor", "thunder", "storm", "frost", "blackhole", "sakura"]; // 烈焰（flame）和隕石太像，老闆 2026-10-31 移除
export const isZimoFx = (x: unknown): x is WinFx => typeof x === "string" && (ZIMO_FX as readonly string[]).includes(x);
/** 金色自摸是所有 LINE 帳號永久可選的預設，不屬於後台可開通／收回的特效。 */
export const GOLDEN_ZIMO_FX: WinFx = "golden";
export const isSelectableZimoFx = (x: unknown): x is WinFx => x === GOLDEN_ZIMO_FX || isZimoFx(x);

/** 老闆帳號（原本綁隕石的那個 LINE 帳號）：後台只有他能用；6 種特效永久全開，沒選過就是隕石 */
export const OWNER_USER_ID = "c5707922-f6f0-4c10-9c87-3532fdbf6b72";
export const isOwner = (userId: string | null | undefined) => userId === OWNER_USER_ID;

const TPE_OFFSET_MS = 8 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
/** now 所在這一週的開始（台北時間週一 00:00）和結束（下週一 00:00，不含），都是 epoch 毫秒 */
export function weekOf(now: number): { start: number; end: number } {
  const local = now + TPE_OFFSET_MS;               // 當成 UTC 來看就是台北的日期時間
  const dayStart = local - (((local % DAY_MS) + DAY_MS) % DAY_MS);
  const dow = (new Date(dayStart).getUTCDay() + 6) % 7; // 週一＝0 … 週日＝6
  const start = dayStart - dow * DAY_MS - TPE_OFFSET_MS;
  return { start, end: start + 7 * DAY_MS };
}

/** 胡牌時用的「這個座位目前的特效」：until＝null 表示永久（老闆） */
export interface ZimoFxNow { code: WinFx; until: number | null }
/** 從資料庫查到的「選用＋有效到期」換成這一刻能不能播。
 *  金色自摸是安全回退：未設定、未開通、已到期、已收回及查詢失敗都回它。 */
export function resolveZimoFx(userId: string | null | undefined, pref: { fx: string; until: number | null } | undefined): ZimoFxNow | undefined {
  if (!userId) return undefined;
  if (pref?.fx === GOLDEN_ZIMO_FX) return { code: GOLDEN_ZIMO_FX, until: null };
  if (isOwner(userId) && isZimoFx(pref?.fx)) return { code: pref.fx, until: null };
  if (!pref || !isZimoFx(pref.fx) || pref.until === null) return { code: GOLDEN_ZIMO_FX, until: null };
  return { code: pref.fx, until: pref.until };
}
/** 這一刻還有效嗎（永久或還沒到期） */
export const zimoFxValid = (fx: ZimoFxNow | undefined, now: number): WinFx | undefined =>
  fx && (fx.until === null || fx.until > now) ? fx.code : undefined;

/** 排行榜：範圍內（null＝不分週）的有效斗內依玩家加總。同額時較早達到該金額（最後一筆較早）的排前面。
 *  名稱、頭像用範圍內最新一筆有效斗內記帳時存的 */
export interface DonationRow { userId: string; name: string; avatarUrl: string | null; amount: number; donatedAt: number; voided: boolean }
export type BoardRow = { rank: number; name: string; avatarUrl: string | null; amount: number };
export const weeklyBoard = (rows: DonationRow[], now: number): BoardRow[] => board(rows, weekOf(now));
export const allTimeBoard = (rows: DonationRow[]): BoardRow[] => board(rows, null);
function board(rows: DonationRow[], range: { start: number; end: number } | null): BoardRow[] {
  const by = new Map<string, { name: string; avatarUrl: string | null; amount: number; last: number; nameAt: number }>();
  for (const r of rows) {
    if (r.voided || (range && (r.donatedAt < range.start || r.donatedAt >= range.end))) continue;
    const g = by.get(r.userId) ?? { name: r.name, avatarUrl: r.avatarUrl, amount: 0, last: 0, nameAt: -Infinity };
    g.amount += r.amount;
    g.last = Math.max(g.last, r.donatedAt);
    if (r.donatedAt >= g.nameAt) { g.name = r.name; g.avatarUrl = r.avatarUrl; g.nameAt = r.donatedAt; } // 用最新一筆的名稱
    by.set(r.userId, g);
  }
  return [...by.values()]
    .sort((a, b) => b.amount - a.amount || a.last - b.last)
    .map((g, i) => ({ rank: i + 1, name: g.name, avatarUrl: g.avatarUrl, amount: g.amount }));
}
