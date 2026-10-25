// 胡牌後播什麼、照什麼順序（老闆 2026-10-25 定案；畫面在 app/mahjong/page.tsx）。只管判斷，不碰 React，node 測試直接跑（tests/_win-show.ts）。
//   ・大牌順序對調：先播自摸／胡浮層（cele），再播大牌專屬段（big），最後才出結算。
//   ・帳號專屬特效（贏家帶 winFx="meteor"，伺服器依帳號給）：自摸時用隕石版自摸（meteor）取代自摸浮層；
//     大牌自摸＝隕石 → 大牌專屬段。放槍胡不播隕石，照一般流程。
//   ・天胡、八仙過海、七搶一（BIG_WIN_ORDER 的 cele=false）照舊：只播大牌專屬段，不接浮層、也不播隕石。
//   ・回傳 ["cele"]＝一般胡牌：沿用原本的慶祝浮層（不擋結算、不記播過），其他組合由頁面依序播完才出結算。
import type { BigWinPick } from "./bigWin";
import type { WinFx } from "./gameState";

export type WinShowStage = "cele" | "meteor" | "big";

/** 現有自摸／胡慶祝浮層的長度（ms），和 page.tsx 的浮層動畫一樣 */
export const CELE_MS = { zimo: 3500, ron: 2000 } as const;

export function planWinShow(o: { pick: BigWinPick | null; zimo: boolean; winFx?: WinFx | string | null }): WinShowStage[] {
  if (o.pick && !o.pick.cele) return ["big"];
  const first: WinShowStage = o.zimo && o.winFx === "meteor" ? "meteor" : "cele";
  return o.pick ? [first, "big"] : [first];
}

/** 浮層接大牌專屬段的時間：浮層在最後 15% 淡出（mj-win-flash 85%→100%），淡出一開始就掛上大牌段，
 *  大牌段的暗幕一開始就是暗的（BigWinFx chained），浮層淡掉時底下已經是暗的，牌桌不會先亮一下 */
export const celeHandoffMs = (mode: "zimo" | "ron") => Math.round(CELE_MS[mode] * 0.85);
