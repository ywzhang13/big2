// 胡牌後播什麼、照什麼順序（老闆 2026-10-25 定案；畫面在 app/mahjong/page.tsx）。只管判斷，不碰 React，node 測試直接跑（tests/_win-show.ts）。
//   ・大牌先播（2026-10-25 老闆定案，八台大牌新版一起改）：先播大牌專屬段（big），再播自摸／胡浮層（cele），最後才出結算。
//   ・帳號專屬特效（贏家帶 winFx="meteor"，伺服器依帳號給）：自摸時用隕石版自摸（meteor）取代自摸浮層；
//     大牌自摸＝大牌專屬段 → 隕石。放槍胡不播隕石，照一般流程。
//   ・帳號自摸特效庫的 5 種新特效（雷霆、風暴、冰封、黑洞、櫻花，老闆 2026-10-31；winFx 是其中之一）：都是完整版，比照隕石——
//     特效自己帶專屬「自摸」大字，取代自摸浮層：自摸＝zfx；大牌自摸＝big → zfx。放槍胡不播，照一般流程。
//     如來神掌（rulai，老闆 2026-11-05）、核彈（nuke，老闆 2026-11-10）是專屬特效，伺服器只給 EXCLUSIVE_FX 指定的那個帳號，走同一條路。
//   ・天胡、八仙過海、七搶一（BIG_WIN_ORDER 的 cele=false）照舊：只播大牌專屬段，不接浮層、也不播隕石或新特效。
//   ・回傳 ["cele"]＝一般胡牌：沿用原本的慶祝浮層（不擋結算、不記播過），其他組合由頁面依序播完才出結算。
import type { BigWinPick } from "./bigWin";
import type { WinFx } from "./gameState";

export type WinShowStage = "cele" | "meteor" | "big" | "zfx";

/** 特效庫的新自摸特效（components/mahjong/ZimoFx.tsx；隕石是另一支 MeteorFx）。
 *  前 5 種是後台可開通的，rulai／nuke 是專屬特效（EXCLUSIVE_FX），伺服器只給被指定的那個帳號 */
export const ZIMO_FX_NEW = ["thunder", "storm", "frost", "blackhole", "sakura", "rulai", "nuke"] as const;
export type ZimoFxNew = (typeof ZIMO_FX_NEW)[number];
export const isZimoFxNew = (x: unknown): x is ZimoFxNew => typeof x === "string" && (ZIMO_FX_NEW as readonly string[]).includes(x);

/** 按到聊天（聊天鈕、底板、送出狀態、語音泡泡）的事件：不算「點畫面跳過特效」（老闆 2026-11-04：點聊天沒反應；打字的空白鍵、Enter 也一樣） */
export const isChatUiEvent = (e: Event) => !!(e.target as Element | null)?.closest?.("[data-chat-btn], [data-chat-panel], [data-chat-status], [data-chat-bubble]");

/** 單一畫布的特效（櫻花紛飛、如來神掌、核彈）：不走零件、不預熱；圖要開播前就解碼好，沒好就退回金色。
 *  核彈的爆炸本體全是程式畫的，只有人物、飛彈、蕈狀雲三張是圖（lib/mahjong/fx/nukeFx.ts） */
export const isCanvasFx = (x: unknown): x is "sakura" | "rulai" | "nuke" => x === "sakura" || x === "rulai" || x === "nuke";
/** 核彈不出「自摸的那張牌」和自摸者的名字：畫面只留爆炸和大字（老闆 2026-11-10） */
export const fxShowsTile = (fx: ZimoFxNew) => fx !== "nuke";
export const fxShowsName = (fx: ZimoFxNew) => fx !== "nuke";
/** 特效的圖載不到：這一段換成金色自摸浮層（其他段不動） */
export const zfxPlanToCele = (plan: WinShowStage[]): WinShowStage[] => plan.map((s) => (s === "zfx" ? "cele" : s));
/** 等圖載好最多 ms 毫秒：載好才 true；失敗、超時都是 false（超時後才載好也不算，已經決定退回了） */
export const artOkWithin = (art: Promise<boolean>, ms: number) => Promise.race([art, new Promise<boolean>((r) => setTimeout(() => r(false), ms))]);
/** 這些圖現在能不能直接畫：一張都沒有、還沒載完、載壞了都不行 */
export const artUsable = (imgs: readonly { complete: boolean; naturalWidth: number }[]) => imgs.length > 0 && imgs.every((i) => i.complete && i.naturalWidth > 0);

/** 現有自摸／胡慶祝浮層的長度（ms），和 page.tsx 的浮層動畫一樣 */
export const CELE_MS = { zimo: 3500, ron: 2000 } as const;

export function planWinShow(o: { pick: BigWinPick | null; zimo: boolean; winFx?: WinFx | string | null }): WinShowStage[] {
  if (o.pick && !o.pick.cele) return ["big"];
  const after: WinShowStage[] = o.zimo && o.winFx === "meteor" ? ["meteor"] : o.zimo && isZimoFxNew(o.winFx) ? ["zfx"] : ["cele"];
  // 大牌段播完不卸下，只留暗幕墊在後面那一段底下（頁面照 plan 掛著，直到整串結束），交接時牌桌不會先亮一下
  return o.pick ? ["big", ...after] : after;
}
