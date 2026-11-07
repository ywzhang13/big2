// 整合測試（審伯 2026-11-08 複審必修）：補花動畫進行中，輪詢拿到真的權威快照（不是過時／晚到／版本落後的
// 回應，前面已經被 StateRequestGate／SyncPolicy 擋掉，見 hooks/useMahjong.ts fetchState）時，要立刻作廢本地
// 還在播的補花動畫；快照之後同一家真的又補到新花，下一段動畫要能正常重新開始。
// 這份測試把 FlowerTracker（basis 追蹤）和 FlowerAnimGuard（動畫序號保護）照 hooks/useMahjong.ts 實際串接
// 兩者的順序組起來，模擬一次完整的「摸到花 → 動畫開始 → 中途收到權威快照 → 動畫被作廢 → 下一次真的補花」。
import { FlowerTracker } from "../lib/mahjong/flowerTracker";
import { FlowerAnimGuard } from "../lib/mahjong/flowerAnimGuard";
import type { RoundInfo } from "../lib/mahjong/gameState";
import type { Tile } from "../lib/mahjong/tiles";

let failed = 0;
const check = (ok: boolean, msg: string) => { if (!ok) failed++; console.log(`${ok ? "✅" : "❌"} ${msg}`); };
const round = (currentRound: number, currentGame: number, dealerConsecutive: number): RoundInfo => ({ currentRound, currentGame, dealerConsecutive, initialDealerSeat: 0 });
const flower = (id: number): Tile => ({ id, suit: "f", rank: 1, display: "春" } as Tile);
const seats = (s0: Tile[] = [], s1: Tile[] = [], s2: Tile[] = [], s3: Tile[] = []) => [s0, s1, s2, s3].map((flowers, seat) => ({ seat, flowers }));
const A = round(1, 1, 0);
const SELF = 0;
const X = flower(140);
const Y = flower(141);

/** 模擬 showFlower／applyFinal 這段巢狀 setTimeout 鏈：每一步都要先過 isStale() 才算「真的寫了 state」 */
function simulateAnimSteps(guard: FlowerAnimGuard, myGen: number, steps: string[]): string[] {
  const applied: string[] = [];
  for (const step of steps) {
    if (guard.isStale(myGen)) break; // 跟真正的 showFlower／applyFinal 一樣：序號過期就整段不再往下走
    applied.push(step);
  }
  return applied;
}

// 1. 補花動畫進行中，輪詢拿到真的權威快照：動畫序號要立刻作廢，剩下沒播完的步驟都不能再寫 state
{
  const tracker = new FlowerTracker();
  const guard = new FlowerAnimGuard();

  tracker.onPoll(seats(), A, SELF); // 開局輪詢：自己還沒有花，建立基線
  const added = tracker.onEvent(SELF, [X]); // mj_draw_tile：自己摸到花 X
  check(added.length === 1 && added[0].id === 140, "準備動畫：mj_draw_tile 正確算出新補的花");

  const myGen = guard.start(); // showFlower(0) 開始播放這張花
  // 權威快照（輪詢）在動畫播到一半時到達（例如 hold 提早釋放、或計時器之間有時間差）：
  // hooks/useMahjong.ts 的 fetchState 在這個分支一定會呼叫 guard.invalidate()
  guard.invalidate();

  const applied = simulateAnimSteps(guard, myGen, ["花出現", "補花字樣", "換下一張花或定案"]);
  check(applied.length === 0, "權威快照到達後，這段補花動畫剩下的步驟（含「補花」字樣）一步都不會再寫 state");
  check(guard.isStale(myGen), "權威快照到達後，這段動畫的序號確實是過期的");
}

// 2. 權威快照作廢動畫之後，同一家真的又摸到新的一張花：新一輪動畫要能正常開始，FlowerTracker 的基線也要正確只算出新花
{
  const tracker = new FlowerTracker();
  const guard = new FlowerAnimGuard();

  tracker.onPoll(seats(), A, SELF);
  tracker.onEvent(SELF, [X]); // 第一張花（已經播過、已經算進基線）
  const oldGen = guard.start();
  guard.invalidate(); // 權威快照到達，作廢第一段動畫（情境同上）

  // 快照之後，牌局繼續，這家真的又摸到第二張花
  const added2 = tracker.onEvent(SELF, [X, Y]);
  check(added2.length === 1 && added2[0].id === 141, "快照作廢動畫之後，同一家真的補到新花，基線只算出新花，不會把第一張也算進去");

  const newGen = guard.start(); // 新一輪動畫開始
  check(guard.isStale(oldGen), "舊動畫的序號仍然是過期的，不會因為開始新動畫又復活");
  check(!guard.isStale(newGen), "新一輪動畫的序號是有效的，可以正常播放、正常寫 state");
  const applied2 = simulateAnimSteps(guard, newGen, ["花出現", "補花字樣", "換下一張花或定案"]);
  check(applied2.length === 3, "新一輪動畫沒有被舊的 invalidate 波及，三個步驟都正常播完");
}

if (failed) process.exit(1);
