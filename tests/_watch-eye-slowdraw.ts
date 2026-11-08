// 單元測試（老闆 2026-11-08）：觀戰眼牌那家摸牌要「慢慢摸」，跟本人畫面的節奏一樣，不能提早出現。
// 根因：mj_draw 原本只靠 soonAfter(EYE_DRAW_MS) 晚一點排「下一次」pull()，但定時輪詢
// （setInterval）、visibilitychange、online 各自也會呼叫 pull()，原本沒有共同的關卡擋住它們，
// 延遲期間還是可能先拉到摸牌後的最新狀態。對照 app/mahjong/watch/page.tsx 的三個純函式：
//   computeEyeDrawDelayMs：這次摸牌要晚幾毫秒（跟玩家自己畫面同一條公式，眼牌＋補花兩段相加）
//   isHeldForSlowDraw：pull() 的關卡本身（所有入口共用同一個判斷）
//   shouldShowSlowDrawFlip：要不要播翻牌動畫
import { computeEyeDrawDelayMs, isHeldForSlowDraw, shouldShowSlowDrawFlip } from "../app/mahjong/watch/page";
import { EYE_DRAW_MS, FLOWER_FX_MS, FLOWER_STAGGER_MS } from "../lib/mahjong/pace";
import type { SpectateView } from "../lib/mahjong/spectateClient";

let failed = 0;
const check = (ok: boolean, msg: string) => { if (!ok) failed++; console.log(`${ok ? "✅" : "❌"} ${msg}`); };

// 情境 1：觀戰到眼牌那家摸牌——要晚 EYE_DRAW_MS（跟玩家自己畫面的翻牌＋停留秒數一樣）
check(computeEyeDrawDelayMs(1, [1, 2], 0) === EYE_DRAW_MS, "眼牌那家摸牌：延遲是 EYE_DRAW_MS（1800ms），跟本人畫面對齊");

// 情境 2：不是眼牌就不慢摸——沒補花、不是眼牌座位，延遲是 0（維持現有行為不變）
check(computeEyeDrawDelayMs(3, [1, 2], 0) === 0, "不是眼牌的座位摸牌：延遲是 0，不慢摸");
check(computeEyeDrawDelayMs(0, [], 0) === 0, "完全沒人眼牌時：延遲是 0");

// 情境 3：補花疊在眼牌上時節奏正確——眼牌＋連續補花兩張，兩段時間要相加，不是只取其中一段
{
  const ms = computeEyeDrawDelayMs(1, [1], 2); // 座位 1 正在眼牌，這次新補了 2 張花
  check(ms === EYE_DRAW_MS + FLOWER_FX_MS + FLOWER_STAGGER_MS, "眼牌疊補花（連續 2 張）：延遲＝EYE_DRAW_MS＋FLOWER_FX_MS＋1 段 STAGGER（跟玩家自己畫面同一條公式）");
}
// 不是眼牌、單純補花（沒疊眼牌）：只有補花那一段，延遲不包含 EYE_DRAW_MS
{
  const ms = computeEyeDrawDelayMs(2, [1], 1); // 座位 2 不是眼牌，補了 1 張花
  check(ms === FLOWER_FX_MS, "不是眼牌、單純補花：延遲只有 FLOWER_FX_MS，不含 EYE_DRAW_MS");
}

// 情境 4：慢摸期間定時更新（或任何其他入口）不會讓牌提早出現——isHeldForSlowDraw 是 pull() 唯一的關卡，
// 不管呼叫者是誰（定時輪詢、soonAfter 排的那次、visibilitychange、online）都要擋住，直到時間到才放行
{
  const start = 1_000_000;
  const hold = { on: true, until: start + EYE_DRAW_MS };
  check(isHeldForSlowDraw(hold, start) === true, "慢摸剛開始：還在關卡裡（定時輪詢這時候打進來也會被擋）");
  check(isHeldForSlowDraw(hold, start + 900) === true, "慢摸進行到一半：還在關卡裡");
  check(isHeldForSlowDraw(hold, start + EYE_DRAW_MS - 1) === true, "慢摸只差 1ms 結束：還是要擋住，不能提早一絲一毫");
  check(isHeldForSlowDraw(hold, start + EYE_DRAW_MS) === false, "慢摸時間到：放行，可以正常拉資料");
  check(isHeldForSlowDraw(hold, start + EYE_DRAW_MS + 5000) === false, "慢摸早就結束：放行");
  check(isHeldForSlowDraw({ on: false, until: 0 }, start) === false, "根本沒有在慢摸（hold.on=false）：永遠不擋，照舊正常拉資料");
}

// 情境 5：shouldShowSlowDrawFlip——只有「正在看的這家」自己摸到新的一張才播翻牌動畫
{
  const base = { drawnTileId: 42, eyeSeats: [1], mySeat: 1 } as Pick<SpectateView, "drawnTileId" | "eyeSeats" | "mySeat">;
  check(shouldShowSlowDrawFlip(base, null) === true, "正在看的這家是眼牌、摸到新牌（之前沒有）：播翻牌動畫");
  check(shouldShowSlowDrawFlip(base, 99) === true, "正在看的這家是眼牌、摸到新牌（跟上一張不同）：播翻牌動畫");
  check(shouldShowSlowDrawFlip(base, 42) === false, "drawnTileId 沒變（重新整理拿到同一份快照）：不重播");
  check(shouldShowSlowDrawFlip({ ...base, eyeSeats: [] }, null) === false, "正在看的這家不是眼牌：不播翻牌動畫，維持現有行為");
  check(shouldShowSlowDrawFlip({ ...base, drawnTileId: null }, null) === false, "這家目前沒有摸到的牌（drawnTileId 是 null）：不播");
}

if (failed) process.exit(1);
