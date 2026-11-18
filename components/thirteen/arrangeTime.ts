// 十三支開房的理牌時間（老闆 2026-11-18）：最少 15 秒、最多 120 秒、只能是 15 的倍數；可以直接輸入，旁邊「＋」每按一次加 15 秒
export const ARRANGE_MIN = 15;
export const ARRANGE_MAX = 120;
export const ARRANGE_STEP = 15;
export const ARRANGE_DEFAULT = 60;

/** 輸入框的值（可能是亂打的字）→ 合法秒數：四捨五入到 15 的倍數，再夾在 15～120；看不懂的回預設 60 */
export function normalizeArrangeSec(raw: string | number): number {
  const n = typeof raw === "number" ? raw : Number(String(raw).replace(/[^\d.]/g, ""));
  if (!Number.isFinite(n) || n <= 0) return ARRANGE_DEFAULT;
  const r = Math.round(n / ARRANGE_STEP) * ARRANGE_STEP;
  return Math.min(ARRANGE_MAX, Math.max(ARRANGE_MIN, r));
}

/** 「＋」：加 15 秒，到 120 為止 */
export const plusArrangeSec = (sec: number) => Math.min(ARRANGE_MAX, normalizeArrangeSec(sec) + ARRANGE_STEP);
/** 「−」：減 15 秒，到 15 為止（老闆 2026-11-18） */
export const minusArrangeSec = (sec: number) => Math.max(ARRANGE_MIN, normalizeArrangeSec(sec) - ARRANGE_STEP);

/** 送給伺服器的秒數：後端已收 15～120、15 秒一階（老柯 d72e01e），照正規化後的值送 */
export function toServerArrangeSec(sec: number): number {
  return normalizeArrangeSec(sec);
}
