// 胡牌後播什麼、照什麼順序（老闆 2026-10-25 定案；畫面在 app/mahjong/page.tsx）。只管判斷，不碰 React，node 測試直接跑（tests/_win-show.ts）。
//   ・大牌先播（2026-10-25 老闆定案，八台大牌新版一起改）：先播大牌專屬段（big），再播自摸／胡浮層（cele），最後才出結算。
//   ・帳號專屬特效（贏家帶 winFx="meteor"，伺服器依帳號給）：自摸時用隕石版自摸（meteor）取代自摸浮層；
//     大牌自摸＝大牌專屬段 → 隕石。放槍胡不播隕石，照一般流程。
//   ・天胡、八仙過海、七搶一（BIG_WIN_ORDER 的 cele=false）照舊：只播大牌專屬段，不接浮層、也不播隕石。
//   ・回傳 ["cele"]＝一般胡牌：沿用原本的慶祝浮層（不擋結算、不記播過），其他組合由頁面依序播完才出結算。
import type { BigWinPick } from "./bigWin";
import type { WinFx } from "./gameState";

export type WinShowStage = "cele" | "meteor" | "big";

/** 現有自摸／胡慶祝浮層的長度（ms），和 page.tsx 的浮層動畫一樣 */
export const CELE_MS = { zimo: 3500, ron: 2000 } as const;

export function planWinShow(o: { pick: BigWinPick | null; zimo: boolean; winFx?: WinFx | string | null }): WinShowStage[] {
  if (o.pick && !o.pick.cele) return ["big"];
  const after: WinShowStage = o.zimo && o.winFx === "meteor" ? "meteor" : "cele";
  // 大牌段播完不卸下，只留暗幕墊在後面那一段底下（頁面照 plan 掛著，直到整串結束），交接時牌桌不會先亮一下
  return o.pick ? ["big", after] : [after];
}
