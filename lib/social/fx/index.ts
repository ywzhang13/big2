// 三款共用的互動道具（小宜〈十三支共用聊天互動 v1〉§6）。
// 播放引擎（engine）、選單計時（createFxMenu）、關閉互動（block）本來就不綁麻將的畫面，這次直接沿用麻將那幾個檔、不複製；
// 麻將這張卡不能改，等麻將換成共用元件那一張卡再把原始檔搬進這個資料夾。這裡另外補：
//   ・送收（transport.ts）：送出網址由遊戲傳進來、多一個 target_arranging
//   ・選單位置（place.ts）：位置由遊戲指定
//   ・名牌錨點換成遊戲自己的鍵（下面 playSocialFx）
export { FX_LABEL, abortFx, enqueueFx, isFxBusy, preloadFx, setFxLayer, setFxVolume, unlockAudio, type FxKind } from "@/lib/mahjong/fx/engine";
export { bindFxBlockRoom, setFxBlocked, shouldPlayFx, useFxBlocked } from "@/lib/mahjong/fx/block";
export { createFxMenu, type FxMenu } from "@/lib/mahjong/fx/menu";
import { enqueueFx, type FxKind } from "@/lib/mahjong/fx/engine";

/** 互動選單上的順序（和麻將一樣）：愛心、砸錢、拍手、丟雞蛋、潑水桶、拳擊 */
export const MENU_ORDER: FxKind[] = ["love", "cash", "clap", "egg", "water", "punch"];
export const FX_ICON: Record<FxKind, string> = {
  love: "/mahjong-fx/heart-glossy.png", cash: "/mahjong-fx/bill-classic.png", egg: "/mahjong-fx/egg-lottie-whole.webp",
  water: "/mahjong-fx/bucket-water.webp", punch: "/mahjong-fx/glove-red.png", clap: "/mahjong-fx/clap-fluent.png",
};

/** 播一次特效。引擎用 `[data-fx-seat="<鍵>"]` 找名牌、用「to 是不是自己」決定三種視角；
 *  麻將的鍵是座位數字，十三支共用名牌（GamePlate）的鍵是相對位置 b／r／t／l，所以這裡收字串鍵。
 *  引擎的型別寫的是 number，但它只拿鍵去拼選擇器和比相等，傳字串行為一樣（等引擎搬進共用資料夾時改成 string） */
export function playSocialFx(job: { kind: FxKind; fromKey: string; toKey: string; meKey: string }): boolean {
  const k = (s: string) => s as unknown as number;
  return enqueueFx({ kind: job.kind, from: k(job.fromKey), to: k(job.toKey), mySeat: k(job.meKey), crack: true, muted: false });
}
