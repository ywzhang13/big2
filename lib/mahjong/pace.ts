// 牌局節奏（老闆 2026-10-17）：補花、眼牌摸牌的特效播完之前，下一家不能摸牌、別人不能吃碰胡搶先。
// 以伺服器時間為準：會播特效的動作把 state.paceUntil 設成「特效播完的時間」；之後任何人的摸牌、打牌、
// 吃碰槓胡、pass 都在伺服器等到這個時間才處理（不拒絕，所以前端不用重送；斷線、重新整理也不會卡住，時間到就照常）。
import type { MahjongGameState } from "./gameState";

export const FLOWER_FX_MS = 1000;     // 補花膠囊（小宜規格：1 秒）
export const FLOWER_STAGGER_MS = 120; // 同時多家補花：一家錯開 0.12 秒
export const EYE_DRAW_MS = 1800;      // 眼牌摸牌：翻牌 0.8 秒＋停 1 秒
export const PACE_MAX_WAIT_MS = 4000; // 保險：最多等這麼久（時鐘異常也不會卡住）

/** 時鐘：測試換成假的（不用真的等） */
export const paceClock = {
  now: () => Date.now(),
  sleep: (ms: number) => new Promise<void>((r) => setTimeout(r, ms)),
};

/** 這次動作要讓大家等多久：哪幾家多了花（補花），以及眼牌的人是不是剛摸牌 */
export function paceMs(before: MahjongGameState, after: MahjongGameState, eyeDrawSeat?: number): number {
  const flowerSeats = after.players.filter((p, i) => p.flowers.length > (before.players[i]?.flowers.length ?? 0)).length;
  const flower = flowerSeats > 0 ? FLOWER_FX_MS + FLOWER_STAGGER_MS * (flowerSeats - 1) : 0;
  const eye = eyeDrawSeat !== undefined && before.eyeSeats?.includes(eyeDrawSeat) ? EYE_DRAW_MS : 0;
  return flower + eye;
}

/** 把等待時間記進要存的狀態（沿用還沒到期的較晚時間） */
export function applyPace(s: MahjongGameState, ms: number): MahjongGameState {
  if (ms <= 0) return s;
  const until = paceClock.now() + ms;
  s.paceUntil = Math.max(s.paceUntil ?? 0, until);
  return s;
}

/** 一個請求的等待額度：整個請求只能 sleep 一次（含樂觀鎖衝突重試），累計不超過 PACE_MAX_WAIT_MS */
export type PaceBudget = { slept: boolean };
export const newPaceBudget = (): PaceBudget => ({ slept: false });

/**
 * 特效還沒播完就等到 paceUntil（最多 4 秒），回傳 true＝等過了，呼叫端要重新讀最新狀態再處理。
 * 同一個請求只會等一次：等過之後就算 paceUntil 還在未來（時間異常、或別人又設了新的），也直接照常處理。
 */
export async function waitPaceOnce(s: Pick<MahjongGameState, "paceUntil">, budget: PaceBudget): Promise<boolean> {
  if (budget.slept) return false;
  const wait = paceWaitMs(s);
  if (wait <= 0) return false;
  budget.slept = true;
  await paceClock.sleep(wait);
  return true;
}

/** 還要等幾毫秒才能處理（0＝不用等） */
export function paceWaitMs(s: Pick<MahjongGameState, "paceUntil">): number {
  if (!s.paceUntil) return 0;
  return Math.min(Math.max(0, s.paceUntil - paceClock.now()), PACE_MAX_WAIT_MS);
}

/** 開局（含下一局）：起手補花的家數，依序播完（一家錯開 0.12 秒） */
export function dealPaceMs(after: MahjongGameState): number {
  const n = after.players.filter((p) => p.flowers.length > 0).length;
  return n > 0 ? FLOWER_FX_MS + FLOWER_STAGGER_MS * (n - 1) : 0;
}
