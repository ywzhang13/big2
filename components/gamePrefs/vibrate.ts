"use client";
// 三款遊戲共用的震動開關（小宜〈共用設定面板 v1〉§6）：只存在這台裝置 localStorage「gp.vibrate」，存 "0" 是關、沒有這個 key 就是開。
// 會不會震本來就看裝置（手機要、電腦沒有），所以不跟帳號；也不用改伺服器。
// 所有「震一下」都走 gameVibrate：先看開關、再看裝置支不支援（iPhone 的瀏覽器沒有 navigator.vibrate）
import { useSyncExternalStore } from "react";

export const VIBRATE_KEY = "gp.vibrate";
const listeners = new Set<() => void>();

/** 這台裝置支不支援震動 */
export const canVibrate = (): boolean => typeof navigator !== "undefined" && typeof navigator.vibrate === "function";

/** 這一頁改過的值（審伯建議：storage 存不了、讀不到時，以這一頁最後一次的設定為準；null＝這一頁沒改過，照 storage） */
let mem: boolean | null = null;
export function vibrateOn(): boolean {
  if (mem !== null) return mem;
  try { return localStorage.getItem(VIBRATE_KEY) !== "0"; } catch { return true; }
}
export function setVibrateOn(on: boolean): void {
  mem = on;
  try { if (on) localStorage.removeItem(VIBRATE_KEY); else localStorage.setItem(VIBRATE_KEY, "0"); } catch { /* 存不了：這一頁照樣用 mem，重新整理後回到 storage 的值 */ }
  listeners.forEach((l) => l());
}

/** 震一下：開關關掉或裝置不支援就不震；回傳有沒有真的叫了震動 */
export function gameVibrate(pattern: number | number[]): boolean {
  if (!vibrateOn() || !canVibrate()) return false;
  try { return navigator.vibrate(pattern); } catch { return false; }
}

function subscribe(l: () => void) {
  listeners.add(l);
  const onStorage = (e: StorageEvent) => { if (e.key === VIBRATE_KEY) { mem = null; l(); } }; // 另一個分頁改了也跟著變（改用 storage 的新值）
  if (typeof window !== "undefined") window.addEventListener("storage", onStorage);
  return () => { listeners.delete(l); if (typeof window !== "undefined") window.removeEventListener("storage", onStorage); };
}
export function useVibrateOn(): boolean {
  return useSyncExternalStore(subscribe, vibrateOn, () => true);
}
