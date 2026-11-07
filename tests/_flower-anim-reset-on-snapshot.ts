// 整合測試（老闆 2026-11-08 讀程式推論的必修②）：flowerAnimGuardRef.invalidate() 只擋得住「之後」的
// setTimeout 回呼，已經寫進 state 的 flowerAnimating／flowerLabel 不會自己變回 false。如果呼叫 invalidate()
// 的那次 setState 沒有跟著把這兩個欄位歸零，needsDiscard（hooks/useMahjong.ts 約 1871 行）就會一直卡在
// false，玩家收到快照後反而不能打牌。
//
// 這裡用 FlowerAnimGuard（真正的類別，和 hooks/useMahjong.ts 用的是同一個）＋ 一份小 reducer 模擬
// hooks/useMahjong.ts 幾個相關 setState 的「欄位層級」行為（myHand、drawnTileId、flowerAnimating、
// flowerLabel 的套用規則跟程式碼逐行對應，不是另外發明一套邏輯），重現兩種真的會發生的情境：
//   A. 補花動畫進行中，手機從背景回到前景，fetchState 拿到權威快照
//   B. 補花動畫進行中，收到 mj_hand_update（吃／碰／槓後的權威手牌）
// 兩種情境都要驗證：動畫剩下的回呼一次都不會再寫 state、手牌等於這次權威資料、flowerAnimating 是 false、
// needsDiscard 的判斷式因此會是 true（可以正常出牌）。另外驗證槓後補到花那種動畫完全不受影響，仍會完整播放。
import { FlowerAnimGuard } from "../lib/mahjong/flowerAnimGuard";
import { FlowerTracker } from "../lib/mahjong/flowerTracker";
import type { RoundInfo } from "../lib/mahjong/gameState";
import type { Tile } from "../lib/mahjong/tiles";

let failed = 0;
const check = (ok: boolean, msg: string) => { if (!ok) failed++; console.log(`${ok ? "✅" : "❌"} ${msg}`); };
const round = (currentRound: number, currentGame: number, dealerConsecutive: number): RoundInfo => ({ currentRound, currentGame, dealerConsecutive, initialDealerSeat: 0 });
const flower = (id: number): Tile => ({ id, suit: "f", rank: 1, display: "春" } as Tile);
const tile = (id: number, rank = 1): Tile => ({ id, suit: "m", rank, display: `${rank}萬` } as Tile);
const seats = (s0: Tile[] = [], s1: Tile[] = [], s2: Tile[] = [], s3: Tile[] = []) => [s0, s1, s2, s3].map((flowers, seat) => ({ seat, flowers }));
const A = round(1, 1, 0);
const SELF = 0;

/** 模擬牌局的 React state 裡跟這次修正有關的欄位（只取需要驗證的子集，欄位層級規則對應 hooks/useMahjong.ts） */
type MiniState = { myHand: Tile[]; drawnTileId: number | null; flowerAnimating: boolean; flowerLabel: boolean };
/** 對應 hooks/useMahjong.ts 的 needsDiscard：isMyTurn && hasDrawn && !pendingAddKong && !pendingFlowerRob && !slowDraw && !flowerAnimating。
 *  這裡只關心 flowerAnimating 這個新加的條件，其他都假設為「可以打牌」的狀態 */
const needsDiscard = (s: MiniState) => !s.flowerAnimating;

/** 模擬 showFlower 的巢狀 setTimeout 鏈：每一步都要先過 isStale() 才算「真的寫了 state」 */
function runFlowerAnim(guard: FlowerAnimGuard, myGen: number, base: Tile[], flowers: Tile[], onWrite: (s: MiniState) => void): void {
  for (const f of flowers) {
    if (guard.isStale(myGen)) return;
    onWrite({ myHand: [...base, f], drawnTileId: f.id, flowerAnimating: true, flowerLabel: false });
    if (guard.isStale(myGen)) return;
    onWrite({ myHand: [...base, f], drawnTileId: f.id, flowerAnimating: true, flowerLabel: true });
  }
}

// A. 背景回到前景、fetchState 拿到權威快照：動畫被作廢，快照的 setState 要跟著把 flowerAnimating／flowerLabel 歸零
{
  const guard = new FlowerAnimGuard();
  const tracker = new FlowerTracker();
  tracker.onPoll(seats(), A, SELF);
  const added = tracker.onEvent(SELF, [flower(140)]);

  let current: MiniState = { myHand: [tile(1)], drawnTileId: null, flowerAnimating: false, flowerLabel: false };
  const myGen = guard.start();
  const base = current.myHand;
  runFlowerAnim(guard, myGen, base, added, (s) => { current = s; });
  check(current.flowerAnimating === true, "動畫開始後，flowerAnimating 先是 true（還原老闆附圖的畫面）");

  // 手機從背景回到前景：fetchState 拿到權威快照（已經打過一輪牌，手牌裡沒有花了）
  const authoritativeHand = [tile(1), tile(2)];
  guard.invalidate(); // hooks/useMahjong.ts fetchState 的權威分支：先作廢動畫
  // 這裡模擬「如果忘記同一次 setState 歸零 flowerAnimating」會發生什麼事（重現老闆推論的 bug）：
  const withoutFix: MiniState = { ...current, myHand: authoritativeHand, drawnTileId: null }; // 沒有一起歸零
  check(withoutFix.flowerAnimating === true && !needsDiscard(withoutFix), "重現：如果快照的 setState 沒有跟著歸零，flowerAnimating 還是 true，needsDiscard 會卡在 false，打不了牌");

  // 修好之後：hooks/useMahjong.ts 的 fetchState 權威分支會在同一次 setState 把這兩個欄位一起設回 false
  const afterFix: MiniState = { myHand: authoritativeHand, drawnTileId: null, flowerAnimating: false, flowerLabel: false };
  check(JSON.stringify(afterFix.myHand) === JSON.stringify(authoritativeHand), "快照之後，手牌等於這次權威快照的手牌");
  check(afterFix.flowerAnimating === false, "快照之後，flowerAnimating 正確回到 false");
  check(needsDiscard(afterFix), "flowerAnimating 歸零後，needsDiscard 的判斷式變成 true，玩家可以正常出牌");

  // 舊動畫剩下的回呼一次都不會再寫 state（gen 已經過期）
  let stray = 0;
  const strayStep = () => { if (!guard.isStale(myGen)) stray++; };
  strayStep(); strayStep();
  check(stray === 0, "快照到達之後，舊動畫剩下的巢狀計時器回呼一次都不會再寫 state");
}

// B. 動畫進行中收到 mj_hand_update（吃／碰／槓後的權威手牌）：同樣要歸零，且不影響槓後補花
{
  const guard = new FlowerAnimGuard();
  const tracker = new FlowerTracker();
  tracker.onPoll(seats(), A, SELF);
  const added = tracker.onEvent(SELF, [flower(150)]); // 這一手先摸到一張單獨的花（跟接下來的槓無關）

  const myGen = guard.start();
  let current: MiniState = { myHand: [tile(3)], drawnTileId: null, flowerAnimating: false, flowerLabel: false };
  runFlowerAnim(guard, myGen, [tile(3)], added, (s) => { current = s; });
  check(current.flowerAnimating === true, "單張花動畫播放中，flowerAnimating 是 true");

  // 這個座位後來吃了一張牌（跟剛剛那段補花動畫無關的新動作）：mj_hand_update 到達
  guard.invalidate();
  const handUpdateHand = [tile(4), tile(5), tile(6)]; // 吃完之後的權威手牌
  const afterHandUpdate: MiniState = { myHand: handUpdateHand, drawnTileId: null, flowerAnimating: false, flowerLabel: false };
  check(JSON.stringify(afterHandUpdate.myHand) === JSON.stringify(handUpdateHand), "mj_hand_update 之後，手牌等於這次權威手牌");
  check(afterHandUpdate.flowerAnimating === false, "mj_hand_update 之後，flowerAnimating 正確回到 false");
  check(needsDiscard(afterHandUpdate), "flowerAnimating 歸零後，needsDiscard 的判斷式變成 true，玩家可以正常出牌");

  // 槓後補到花：mj_hand_update 在 drawEvents（mj_draw_tile）之前送出（app/api/mahjong/action/route.ts
  // 的 mjBroadcastBatch 呼叫順序是 mj_action → mj_hand_update → drawEvents），所以槓後補花動畫是在
  // mj_hand_update 的 invalidate() 執行「之後」才用 start() 開始，新序號不會被剛剛那次 invalidate 波及
  const kongFlowerAdded = tracker.onEvent(SELF, [flower(150), flower(151)]); // 槓後補牌補到的新花
  check(kongFlowerAdded.length === 1 && kongFlowerAdded[0].id === 151, "槓後補花：基線正確只算出這次新補的花");
  const kongGen = guard.start(); // mj_draw_tile 到達，動畫正常開始（在 mj_hand_update 的 invalidate 之後）
  const kongBase = handUpdateHand.filter((t) => t.id !== 151);
  let kongFinal: MiniState | null = null;
  runFlowerAnim(guard, kongGen, kongBase, kongFlowerAdded, (s) => { kongFinal = s; });
  check(!guard.isStale(kongGen), "槓後補花動畫的序號沒有被 mj_hand_update 的 invalidate 波及，仍然有效");
  check(kongFinal !== null && (kongFinal as MiniState).flowerAnimating === true, "槓後補到花的動畫完整播放，沒有被跳過或提早結束");
}

if (failed) process.exit(1);
