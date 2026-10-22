// 提醒聲「滴滴」時，自己的手牌同步輕輕抖一下，像鬧鐘在桌上震動（老闆 2026-10-22 選定：只抖自己的手牌）。
// 只有輪到的人自己的畫面會抖（提醒聲本來就只在自己回合響）；幅度 ≤2px、不到半秒，不會讓牌點不到或點錯；
// 系統設定「減少動態」的人不抖（globals.css 的 prefers-reduced-motion）。畫面在背景時不抖（看不到，回來也不補）。
const CLASS = "mj-remind-shake";

/** 手牌抖一下；回傳抖了幾個元素，背景中或找不到手牌就是 0 */
export function shakeHandForRemind(): number {
  if (typeof document === "undefined" || document.hidden) return 0;
  const els = [...document.querySelectorAll<HTMLElement>("[data-mj-myhand]")];
  for (const el of els) {
    el.classList.remove(CLASS);
    void el.offsetWidth; // 重新開始動畫
    el.classList.add(CLASS);
    setTimeout(() => el.classList.remove(CLASS), 600);
  }
  return els.length;
}
