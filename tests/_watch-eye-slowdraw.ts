// 單元測試（老闆 2026-11-08）：觀戰眼牌那家摸牌要「慢慢摸」，跟本人畫面的節奏一樣，不能提早出現。
// 根因：mj_draw 原本只靠 soonAfter(EYE_DRAW_MS) 晚一點排「下一次」pull()，但定時輪詢
// （setInterval）、visibilitychange、online 各自也會呼叫 pull()，原本沒有共同的關卡擋住它們，
// 延遲期間還是可能先拉到摸牌後的最新狀態。對照 app/mahjong/watch/page.tsx 的三個純函式：
//   computeEyeDrawDelayMs：這次摸牌要晚幾毫秒（跟玩家自己畫面同一條公式，眼牌＋補花兩段相加）
//   isHeldForSlowDraw：pull() 的關卡本身（所有入口共用同一個判斷）
//   shouldShowSlowDrawFlip：要不要播翻牌動畫
import {
  applyGameOverEvent, buildMidDrawView, computeEyeDrawDelayMs, findJustDrawnTile, isHeldForSlowDraw,
  shouldApplyDelayedSettlement, shouldExitOnRoomGone, shouldShowSlowDrawFlip, WATCH_FLIP_MS, type GameOverPayload,
} from "../app/mahjong/watch/page";
import { EYE_DRAW_MS, FLOWER_FX_MS, FLOWER_STAGGER_MS } from "../lib/mahjong/pace";
import type { SpectateView } from "../lib/mahjong/spectateClient";
import type { Tile } from "../lib/mahjong/tiles";

const tile = (id: number, display = `${id}萬`): Tile => ({ id, suit: "m", rank: 1, display } as Tile);

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

// ===== 審伯首審擋下的三項（老闆 2026-11-08 第二次）=====
// 用假時鐘（自己傳 now／round 值，不靠真的 setTimeout）模擬 app/mahjong/watch/page.tsx 的 mj_draw →
// mj_game_over → pull() 404／410 這一批事件的真實順序。

// 情境 6（必修①）：眼牌自摸是整場最後一局——mj_game_over 一到就要「立刻」（不等慢摸的畫面延遲）
// 讓 finalSettlementRef 反映正確狀態，這樣即使 pull() 搶先一步在畫面套用之前就先拿到 404／410，
// 也不會被誤判成房間中途關閉而自動退出
{
  const viewBeforeDraw = { status: "playing", currentTurn: 1, playerScores: [0, 0, 0, 0] } as unknown as SpectateView;
  const payload: GameOverPayload = {
    winnerSeat: 1, winnerName: "阿美", score: { fans: ["自摸"], totalFan: 1 }, winners: [],
    settlement: {}, playerScores: [100, -100, 0, 0], roundInfo: { currentRound: 1, currentGame: 1, dealerConsecutive: 0 }, gameOver: true,
  };
  // 這一步對應「收到 mj_game_over，立刻同步更新 viewRef／finalSettlementRef」（還沒等慢摸的 setTimeout）
  const next = applyGameOverEvent(viewBeforeDraw, payload);
  const finalSettlementSetImmediately = next !== null && payload.gameOver === true;
  check(finalSettlementSetImmediately, "眼牌自摸最後一局：mj_game_over 一到，finalSettlementRef 立刻（同步）設為 true，不等慢摸的畫面延遲");
  // 這一步對應「在畫面真的套用結算之前，pull() 搶先一步拿到房間已刪的 404」
  check(shouldExitOnRoomGone(404, finalSettlementSetImmediately) === false, "搶在畫面套用之前先到的 404：因為 finalSettlementRef 已經是 true，不會自動退出，結算留著");
  check(shouldExitOnRoomGone(410, finalSettlementSetImmediately) === false, "同上，410 也一樣不會自動退出");
}

// 情境 7（必修②，最佳可行驗證）：不是眼牌時的一般觀戰流程完全不受影響——沒有慢摸就不會延後畫面，
// mj_game_over 立刻套用，翻牌動畫也不會播
// ⚠️ 關於「摸牌當下開始翻 800ms、1800ms 才進入摸牌後狀態」：查證後發現伺服器對眼牌玩家的摸牌／自動
// 打出是同一個 API 請求內原子處理（app/api/mahjong/draw/route.ts 的 autoDiscarded），REST 輪詢拿到的
// 一定已經是摸牌＋處理完的最終結果，沒有「已摸牌、還沒打出」的中繼狀態可以查詢；玩家本人的翻牌動畫
// 能在 0ms 開始，是因為私人事件 mj_draw_tile 在同一個請求的回應裡就直接帶了那張牌。觀戰者要在真正
// 摸牌當下（而不是資料到齊後）就看到翻牌，需要伺服器額外送一個帶牌面的私人廣播給核准觀戰的人——這是
// 後端改動，這輪沒有動，已經回報阿哲，不自己加。這裡驗證的是「資料到齊後翻牌動畫會正確觸發」這個
// 已經做到的部分（情境 5），以及没有慢摸時完全不受影響：
check(computeEyeDrawDelayMs(2, [], 0) === 0, "不是眼牌：延遲 0，資料一到就套用，不會多等 800ms 或 1800ms");

// 情境 8（必修③）：慢摸期間如果新局快照先到（viewRef 的 roundInfo 已經換成下一局），延後套用的舊結算
// 不能把新局蓋回去；alive=false（換視角、離開觀戰）也要跳過
{
  const roundA = { currentRound: 1, currentGame: 1, dealerConsecutive: 0 };
  const roundB = { currentRound: 1, currentGame: 2, dealerConsecutive: 0 }; // 下一局
  check(shouldApplyDelayedSettlement(true, roundA, roundA) === true, "正常情況：alive=true、還是同一局（roundInfo 相同）——可以套用");
  check(shouldApplyDelayedSettlement(true, roundB, roundA) === false, "慢摸期間已經換局（viewRef 的 roundInfo 變成下一局）：不套用，不會把舊結算蓋回新局");
  check(shouldApplyDelayedSettlement(false, roundA, roundA) === false, "慢摸期間換視角／離開觀戰（alive=false）：不套用，就算局次沒變也一樣跳過");
  check(shouldApplyDelayedSettlement(false, roundB, roundA) === false, "alive=false 又換了局：雙重理由都不套用");
}

// ===== 審伯首審②（老闆 2026-11-08 第三次）：觀戰的翻牌要跟本人同一條時間軸 =====
// t=0（收到 mj_draw）就用「已經處理完」的狀態（newView）配合 findJustDrawnTile／buildMidDrawView
// 往回推一份「剛摸到、還沒打出」的中繼畫面，立刻顯示＋開始翻牌；WATCH_FLIP_MS（800ms）翻完、停住；
// 到 EYE_DRAW_MS（1800ms）才換成 newView 本身（打出後的狀態，或自摸結算）。

check(WATCH_FLIP_MS === 800, "翻牌動畫播放 800ms，跟玩家自己畫面的 SLOW_DRAW_MS 一樣長");
check(WATCH_FLIP_MS < EYE_DRAW_MS, "800ms 翻完後還要再停到 1800ms 才出結果，不是翻完就立刻顯示");

// 情境 9：一般摸牌後自動打出——剛摸到的牌＝newView.lastDiscard 那張（seat 自己打出的）
{
  const t = tile(201, "7筒");
  const newView = { status: "playing", lastDiscard: { tile: t, from: 2 }, winner: undefined, winners: undefined } as unknown as SpectateView;
  const found = findJustDrawnTile(newView, 2);
  check(found?.id === 201, "一般摸牌後自動打出：找到的剛摸到的牌，就是這家自己打出的那張（lastDiscard）");
  check(findJustDrawnTile(newView, 3) === null, "別人打的牌不算是座位 3 剛摸到的牌：找不到");
}

// 情境 10：自摸結束——剛摸到的牌＝winner.winTile（結算用的「胡的那張」）
{
  const t = tile(202, "東");
  const newView = { status: "finished", lastDiscard: null, winner: { seat: 1, name: "阿美", score: {}, winTile: t }, winners: undefined } as unknown as SpectateView;
  check(findJustDrawnTile(newView, 1)?.id === 202, "自摸結束：找到的剛摸到的牌是 winner.winTile（胡的那張）");
  check(findJustDrawnTile(newView, 1 + 1) === null, "不是胡牌的那家：找不到剛摸到的牌（不該亂顯示翻牌動畫）");
}

// 情境 11：槓後補牌、連續吃碰這類找不到「摸一張就定案」的情況——回傳 null，呼叫端會退回整段延遲的做法
{
  const newView = { status: "playing", lastDiscard: { tile: tile(203), from: 0 }, winner: undefined, winners: undefined } as unknown as SpectateView;
  check(findJustDrawnTile(newView, 1) === null, "打牌的不是這家自己、也不是這家自摸：找不到，呼叫端退回原本整段延遲的做法");
}

// 情境 12：buildMidDrawView——t=0 的中繼畫面要讓翻牌動畫顯示正確的牌，且不能提早露出「打出後」或「自摸結算」
{
  const oldHand = [tile(1), tile(2), tile(3)];
  const oldView = { myHand: oldHand, lastDiscard: null, focusDiscard: null } as unknown as SpectateView;
  const drawn = tile(999, "9筒");
  const newViewDiscarded = {
    status: "playing", myHand: [tile(2), tile(3), tile(4)], lastDiscard: { tile: drawn, from: 1 }, focusDiscard: { tile: drawn, from: 1 }, drawnTileId: null,
  } as unknown as SpectateView;
  const mid = buildMidDrawView(oldView, newViewDiscarded, drawn);
  check(mid.myHand.length === 4 && mid.myHand.some((t) => t.id === 999), "中繼畫面：手牌是舊手牌＋剛摸到的那張（共 4 張），翻牌動畫找得到這張牌");
  check(mid.drawnTileId === 999, "中繼畫面：drawnTileId 指到剛摸到的那張，翻牌動畫（SlowDrawTile）比對得到");
  check(mid.lastDiscard === null, "中繼畫面：棄牌堆維持舊狀態（還沒打出），不會提早看到「已經打出」的畫面");

  const newViewWin = {
    status: "finished", myHand: [tile(2), tile(3), drawn], lastDiscard: null, focusDiscard: null, drawnTileId: null,
    winner: { seat: 1, name: "阿美", score: { fans: ["自摸"], totalFan: 1 }, winTile: drawn },
  } as unknown as SpectateView;
  const midWin = buildMidDrawView(oldView, newViewWin, drawn);
  check(midWin.status === "playing", "自摸情境的中繼畫面：status 強制設回 playing，結算不會在 t=0～800ms 提早出現");
  check(midWin.winner?.seat === 1, "自摸情境的中繼畫面：winner 資料還在（之後換成最終畫面時可以直接用），只是先不顯示");
}

if (failed) process.exit(1);
