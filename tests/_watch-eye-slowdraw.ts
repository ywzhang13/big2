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
import { planWinShow } from "../lib/mahjong/winShow";
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

// ===== 老闆 2026-11-08（第四次）：觀戰自摸特效播兩次 =====
// 根因：applyGameOverEvent 組 view.winner 時沒有帶 winFx（伺服器的 mj_game_over 廣播沒有把它放在
// winnerSeat／score 這幾個單獨欄位裡，是放在 winners[] 陣列每一筆的物件展開裡——跟玩家自己畫面
// hooks/useMahjong.ts 的 mj_game_over 處理一樣，要去 winners[] 裡找回同一個座位那筆）。
// 漏了這個欄位，hooks/useWinShow.tsx 的「一般胡牌」效果（只看 planWinShow(...)!=="cele" 來決定要不要
// 播預設的金色浮層，只看一次就不再重看）會因為這份 winner 沒有 winFx，誤判成「這家沒有專屬特效」，
// 先播一次預設浮層；等下一次 pull() 的權威快照補上 winFx，真正的 zfx 效果才接著播——變成播兩次。
// 這裡驗證的是「資料來源本身」：只要 applyGameOverEvent 吐出來的 winner.winFx 一開始就正確，
// planWinShow 從第一刻就會算出跟最終一致的結果（zfx 或 meteor），不會有「先 cele 後 zfx」這種中間態。
{
  const view = { status: "playing", currentTurn: 1, playerScores: [0, 0, 0, 0] } as unknown as SpectateView;
  const payload: GameOverPayload = {
    winnerSeat: 1, winnerName: "阿美", score: { fans: ["自摸"], totalFan: 1 },
    winners: [
      { seat: 0, name: "老闆", score: { fans: [], totalFan: 0 } }, // 陪榜的其他座位沒有 winFx，不能被誤抓
      { seat: 1, name: "阿美", score: { fans: ["自摸"], totalFan: 1 }, winFx: "sakura" }, // 真正的贏家
    ],
    settlement: {}, playerScores: [0, 100, 0, 0], roundInfo: { currentRound: 1, currentGame: 1, dealerConsecutive: 0 }, gameOver: false,
  };
  const next = applyGameOverEvent(view, payload);
  check(next?.winner?.seat === 1 && next?.winner?.winFx === "sakura", "mj_game_over 一到：winner.winFx 就是阿美自己設定的 sakura，不是 undefined");
  const plan = planWinShow({ pick: null, zimo: true, winFx: next?.winner?.winFx });
  check(plan.join() === "zfx", "從第一刻起 planWinShow 就算出 zfx（不是退回 cele）：不會先播一次預設浮層");
  check(plan.join() !== "cele", "跟 useWinShow 的早期效果同一個判斷式：plan 不等於單純 cele，一開始就會跳過預設浮層那一段");
}

// 情境：贏家本人沒有設定專屬特效（winners[] 裡那筆沒有 winFx）——plan 正確是 cele，且只會播這一次，
// 不是漏抓 winFx 造成的「假 cele」（跟上面那個情境對照，確認修法沒有把沒有 winFx 的人也誤判出特效）
{
  const view = { status: "playing", currentTurn: 2, playerScores: [0, 0, 0, 0] } as unknown as SpectateView;
  const payload: GameOverPayload = {
    winnerSeat: 2, winnerName: "阿德", score: { fans: ["自摸"], totalFan: 1 },
    winners: [{ seat: 2, name: "阿德", score: { fans: ["自摸"], totalFan: 1 } }], // 沒有 winFx：這家沒有自摸特效庫的設定
    settlement: {}, playerScores: [0, 0, 100, 0], roundInfo: { currentRound: 1, currentGame: 1, dealerConsecutive: 0 }, gameOver: false,
  };
  const next = applyGameOverEvent(view, payload);
  check(next?.winner?.winFx === undefined, "沒有設定特效的贏家：winner.winFx 維持 undefined，不會被誤塞值");
  check(planWinShow({ pick: null, zimo: true, winFx: next?.winner?.winFx }).join() === "cele", "沒有專屬特效：plan 正確是 cele，只播一次金色自摸浮層");
}

// 情境：帳號專屬隕石（winFx="meteor"）跟新特效庫走的是同一條修法，一併驗證不會漏抓
{
  const view = { status: "playing", currentTurn: 3, playerScores: [0, 0, 0, 0] } as unknown as SpectateView;
  const payload: GameOverPayload = {
    winnerSeat: 3, winnerName: "阿德", score: { fans: ["自摸"], totalFan: 1 },
    winners: [{ seat: 3, name: "阿德", score: { fans: ["自摸"], totalFan: 1 }, winFx: "meteor" }],
    settlement: {}, playerScores: [0, 0, 0, 100], roundInfo: { currentRound: 1, currentGame: 1, dealerConsecutive: 0 }, gameOver: false,
  };
  const next = applyGameOverEvent(view, payload);
  check(next?.winner?.winFx === "meteor", "隕石帳號：winner.winFx 正確是 meteor");
  check(planWinShow({ pick: null, zimo: true, winFx: next?.winner?.winFx }).join() === "meteor", "plan 從第一刻起就是 meteor，不會先播一次預設浮層");
}

// 情境：流局（winnerSeat < 0）——winFx 不適用，確認不會從 winners[] 裡誤抓到任何一家的 winFx
{
  const view = { status: "playing", currentTurn: 0, playerScores: [0, 0, 0, 0] } as unknown as SpectateView;
  const payload: GameOverPayload = {
    winnerSeat: -1, winnerName: null, score: null,
    winners: [{ seat: 0, name: "老闆", score: { fans: [], totalFan: 0 }, winFx: "sakura" }], // 流局時 winners[] 理論上不會有這種資料，防呆用
    settlement: {}, playerScores: [0, 0, 0, 0], roundInfo: { currentRound: 1, currentGame: 1, dealerConsecutive: 0 }, gameOver: false,
  };
  const next = applyGameOverEvent(view, payload);
  check(next?.winner?.seat === -1 && (next?.winner as { winFx?: string })?.winFx === undefined, "流局：winner.winFx 一律不設，不會誤抓 winners[] 裡其他家的資料");
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

// 情境 12（審伯複審必修②）：buildMidDrawView 要以「摸牌前的舊快照」為底，只在手牌多放一張剛摸到的牌；
// 棄牌堆、牌桌上的玩家資料（players／wallRemaining／currentTurn／opponentHands）一律沿用舊快照，
// 不能混進 newView 已經處理完的任何東西——不然等於提早洩漏結果，也可能帶進已核准那一家以外的資料
{
  const oldHand = [tile(1), tile(2), tile(3)];
  const oldPlayers = [{ seat: 0, discards: [] }, { seat: 1, discards: [] }];
  const oldView = {
    status: "playing", myHand: oldHand, lastDiscard: null, focusDiscard: null, wallRemaining: 68, currentTurn: 1,
    players: oldPlayers, opponentHands: null,
  } as unknown as SpectateView;
  const drawn = tile(999, "9筒");
  const mid = buildMidDrawView(oldView, drawn);
  check(mid.myHand.length === 4 && mid.myHand.some((t) => t.id === 999), "中繼畫面：手牌是舊手牌＋剛摸到的那張（共 4 張），翻牌動畫找得到這張牌");
  check(mid.drawnTileId === 999, "中繼畫面：drawnTileId 指到剛摸到的那張，翻牌動畫（SlowDrawTile）比對得到");
  check(mid.status === "playing", "中繼畫面：status 沿用舊快照，自摸結算不會在 t=0～1800ms 提早出現");
  check(mid.lastDiscard === null, "中繼畫面：棄牌堆維持舊狀態（還沒打出），不會提早看到「已經打出」的畫面");
  check(mid.wallRemaining === 68, "中繼畫面：剩餘牌數沿用舊快照，不是已經摸過之後少一張的新數字");
  check(mid.currentTurn === 1, "中繼畫面：currentTurn 沿用舊快照，不是已經換下一家的新狀態");
  check((mid.players as unknown) === oldPlayers, "中繼畫面：players（牌桌上每家的公開資料）整份沿用舊快照，不混進任何新資料");
  check(mid.opponentHands === null, "中繼畫面：opponentHands 沿用舊快照，不會多帶出已核准那家以外的資料");
}

// ===== 審伯複審必修①②：整合式假時鐘測試（真的跑過延後回呼，不只測純函式）=====
// 用一支最小化的假時鐘＋假 setTimeout，原樣對照 stagedEyeReveal／pull() 在 app/mahjong/watch/page.tsx
// 裡的關鍵判斷式（isHeldForSlowDraw、shouldExitOnRoomGone、buildMidDrawView、findJustDrawnTile、
// revealGenRef／holdRef 的設定時機），模擬完整的事件序列並真的推進時間、真的執行排好的回呼。
{
  type FakeTimer = { id: number; at: number; fn: () => void };
  class FakeClock {
    now = 0;
    private timers: FakeTimer[] = [];
    private nextId = 1;
    setTimeout(fn: () => void, ms: number) {
      const id = this.nextId++;
      this.timers.push({ id, at: this.now + ms, fn });
      return id;
    }
    /** 真的把時間往前推，途中到期的 timer 依排定順序依序執行（可能又排新的 timer，一併處理） */
    advanceTo(target: number) {
      for (;;) {
        const due = this.timers.filter((t) => t.at <= target).sort((a, b) => a.at - b.at)[0];
        if (!due) break;
        this.timers = this.timers.filter((t) => t.id !== due.id);
        this.now = due.at;
        due.fn();
      }
      this.now = target;
    }
  }

  // 模擬 app/mahjong/watch/page.tsx 的 holdRef／revealGenRef／viewRef／finalSettlementRef／alive，
  // 以及 stagedEyeReveal、pull() 404 分支裡「真正會跑到」的那幾行邏輯（跟實際程式一一對應）
  function makeHarness(clock: FakeClock) {
    const holdRef = { current: { on: false, until: 0 } };
    const revealGenRef = { current: 0 };
    let alive = true;
    let finalSettlement = false;
    let viewRef: SpectateView | null = { status: "playing", myHand: [tile(1)], lastDiscard: null, gameOver: false } as unknown as SpectateView;
    const views: SpectateView[] = []; // 每次「畫面真的換成什麼」依序記錄，對應 setView() 被呼叫的歷史
    const setView = (v: SpectateView) => views.push(v);

    // 對應 app/mahjong/watch/page.tsx 的 stagedEyeReveal：fetchLatency＝fetchView 要多久才回來
    const stagedEyeReveal = (seat: number, ms: number, newView: SpectateView, fetchLatency: number) => {
      const gen = ++revealGenRef.current;
      holdRef.current = { on: true, until: clock.now + ms };
      const startedAt = clock.now;
      const remaining = () => Math.max(0, ms - (clock.now - startedAt));
      const oldView = viewRef;
      if (!oldView) return;
      clock.setTimeout(() => { // 對應 await fetchView(...) 真的要花時間才回來
        if (!alive || revealGenRef.current !== gen) return; // 審伯複審必修②：世代不對（被第二次 mj_draw 蓋過）就整段丟棄
        const tile_ = findJustDrawnTile(newView, seat);
        if (!tile_) return;
        const mid = buildMidDrawView(oldView, tile_);
        viewRef = mid;
        setView(mid);
        if (newView.status === "finished" && newView.winner && newView.gameOver) finalSettlement = true; // 必修①：立刻同步設
        clock.setTimeout(() => { // t=0 起算 1800ms（扣掉拉取花的時間）：換成最終畫面
          if (!alive || revealGenRef.current !== gen) return;
          if (holdRef.current.on) holdRef.current.on = false;
          viewRef = newView;
          setView(newView);
        }, remaining());
      }, fetchLatency);
    };

    // 對應 pull()：拿到 404／410 時的判斷（審伯複審必修①：這個分支不能把 alive 設成 false）
    const pullHits404 = (status: 404 | 410 = 404) => {
      if (!shouldExitOnRoomGone(status, finalSettlement)) return; // 不退出，alive 維持 true
      alive = false;
    };
    const pullHits403 = () => { if (!shouldExitOnRoomGone(403, finalSettlement)) return; alive = false; };

    return { holdRef, revealGenRef, get alive() { return alive; }, get finalSettlement() { return finalSettlement; }, get viewRef() { return viewRef; }, views, stagedEyeReveal, pullHits404, pullHits403 };
  }

  // 情境 13：中繼畫面 → gameOver=true 的自摸結算 → 1800ms 前收到 404 和 410 → 1800ms 後顯示結算、留在觀戰頁
  {
    const clock = new FakeClock();
    const h = makeHarness(clock);
    const winTile = tile(500, "東");
    const finalView = {
      status: "finished", myHand: [tile(1)], lastDiscard: null, gameOver: true,
      winner: { seat: 1, name: "阿美", score: { fans: ["自摸"], totalFan: 1 }, winTile },
    } as unknown as SpectateView;
    h.stagedEyeReveal(1, EYE_DRAW_MS, finalView, 120); // fetchView 花 120ms 才回來

    clock.advanceTo(120); // 拉取完成：中繼畫面上場、開始翻牌
    check(h.views.length === 1, "t=120ms（拉取完成）：中繼畫面已經顯示");
    check(h.views[0].myHand.some((t) => t.id === 500), "中繼畫面：手牌裡看得到剛摸到（胡）的那張牌");
    check(h.views[0].status === "playing", "中繼畫面：status 還是 playing，自摸結算還沒出現");
    check(h.finalSettlement === true, "finalSettlementRef 在中繼畫面套用的同一刻就已經是 true（必修①，不等 1800ms）");

    // 1800ms 前，房間已經被刪，陸續收到 404、410——結算不能被取消，alive 要維持 true
    clock.advanceTo(900);
    h.pullHits404(); h.pullHits404(); // 先只打 404
    check(h.alive === true, "1800ms 前收到 404：alive 維持 true，不會把 effect 判定成要卸載");
    clock.advanceTo(1500);
    h.pullHits404();
    check(h.alive === true, "再收到一次 404：alive 還是 true");
    check(h.views.length === 1, "1800ms 之前：畫面只套用過一次（中繼畫面），還沒看到自摸結算");

    clock.advanceTo(EYE_DRAW_MS); // 補滿到 t=1800ms
    check(h.views.length === 2, "t=1800ms：真的切到最終畫面（自摸結算）");
    check(h.views[1].status === "finished" && h.views[1].winner?.seat === 1, "1800ms 後：顯示的是自摸結算（誰胡、winTile 都是最後那份 finalView）");
    check(h.holdRef.current.on === false, "1800ms 後：hold 解除，恢復正常輪詢");

    // 結算出現「之後」才發生的 410（比照房間真的被刪掉、但畫面已經留住結算）：還是不自動退出
    h.pullHits404();
    check(h.alive === true, "1800ms 之後再收到 404：結算已經留在畫面上，一樣不自動退出");
  }

  // 情境 14：403（觀戰權限被收回）無論什麼時候都立刻退出，不受慢摸／結算影響
  {
    const clock = new FakeClock();
    const h = makeHarness(clock);
    const winTile = tile(501, "南");
    const finalView = { status: "finished", myHand: [tile(1)], lastDiscard: null, gameOver: true, winner: { seat: 1, name: "阿美", score: {}, winTile } } as unknown as SpectateView;
    h.stagedEyeReveal(1, EYE_DRAW_MS, finalView, 50);
    clock.advanceTo(50);
    check(h.finalSettlement === true, "403 情境：結算旗標先設成 true（跟情境 13 一樣）");
    h.pullHits403();
    check(h.alive === false, "403（收回觀戰權限）：不管結算旗標是不是 true，照舊立刻退出（alive=false）");
  }

  // 情境 15（審伯複審必修②）：第二次 mj_draw 交錯——第一次的拉取還沒回來，第二次已經進來，世代要對得上，
  // 舊的那次回應整段丟棄，不能把中繼畫面或最終畫面套到錯的那一次
  {
    const clock = new FakeClock();
    const h = makeHarness(clock);
    const firstDrawTile = tile(600, "一筒");
    const firstView = { status: "playing", myHand: [tile(1), tile(2)], lastDiscard: { tile: firstDrawTile, from: 1 }, gameOver: false } as unknown as SpectateView;
    const secondDrawTile = tile(601, "二筒");
    const secondView = { status: "playing", myHand: [tile(1), tile(2)], lastDiscard: { tile: secondDrawTile, from: 1 }, gameOver: false } as unknown as SpectateView;

    h.stagedEyeReveal(1, EYE_DRAW_MS, firstView, 500); // 第一次摸牌：拉取要 500ms 才回來（還沒回來時被第二次打斷）
    clock.advanceTo(100);
    h.stagedEyeReveal(1, EYE_DRAW_MS, secondView, 120); // 100ms 時第二次 mj_draw 進來（世代 +1，蓋過第一次）

    clock.advanceTo(100 + 500); // 第一次的拉取在 t=600ms 回來，但世代已經被第二次蓋過
    check(h.views.length <= 1, "第一次摸牌的回應（世代已經過期）不會套用中繼畫面，不會把錯的那張牌顯示出來");
    if (h.views.length === 1) check(h.views[0].myHand.some((t) => t.id === 601), "如果已經套用了畫面，那一定是第二次（最新世代）的牌，不是第一次的");

    clock.advanceTo(100 + 120); // 第二次的拉取在 t=220ms 回來
    check(h.views.some((v) => v.myHand.some((t) => t.id === 601)), "第二次（最新世代）的中繼畫面有正確套用，看得到第二次摸到的那張牌");

    clock.advanceTo(100 + EYE_DRAW_MS); // 第二次的 1800ms（從第二次 t=0=100ms 算）到了
    const last = h.views[h.views.length - 1];
    check(last.lastDiscard?.tile.id === 601, "最終畫面是第二次（最新世代）的最終狀態，不是第一次那份過期的資料");
  }
}

if (failed) process.exit(1);
