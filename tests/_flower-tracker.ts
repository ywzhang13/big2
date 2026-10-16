// 補花特效基線（FlowerTracker）：漏收開局事件時，上一局的花牌 id 不能留到新局，害新局補同一個 id 的花不播
import { FlowerTracker, compareGameKey, gameKeyOf } from "../lib/mahjong/flowerTracker";
import type { RoundInfo } from "../lib/mahjong/gameState";
import type { Tile } from "../lib/mahjong/tiles";

let failed = 0;
const check = (ok: boolean, msg: string) => { if (!ok) failed++; console.log(`${ok ? "✅" : "❌"} ${msg}`); };
const round = (currentRound: number, currentGame: number, dealerConsecutive: number): RoundInfo => ({ currentRound, currentGame, dealerConsecutive, initialDealerSeat: 0 });
const flower = (id: number, rank = 1): Tile => ({ id, suit: "f", rank, display: "春" } as Tile);
const seats = (s0: Tile[] = [], s1: Tile[] = [], s2: Tile[] = [], s3: Tile[] = []) => [s0, s1, s2, s3].map((flowers, seat) => ({ seat, flowers }));
const X = flower(140);
const A = round(1, 1, 0);
const B = round(1, 2, 0); // 換莊後的下一局

// 1. 審伯的情境：上一局有花 X → 漏收開局 → 新局輪詢 0 張花 → 本局再摸到 X：恰好播一次
{
  const t = new FlowerTracker();
  t.onGameStart(seats([X]), A);
  t.onPoll(seats([X]), A);
  t.onPoll(seats(), B); // 漏收 mj_game_start，輪詢先看到新局
  const first = t.onEvent(0, [X]);
  check(first.length === 1 && first[0].id === 140, "漏收開局後，新局摸到上一局用過的花 id：播 1 次");
  t.onPoll(seats([X]), B);
  check(t.onEvent(0, [X]).length === 0, "同一張花之後的輪詢、廣播都不再重播");
}
// 2. 重新整理：第一次拿到的狀態只記不播，之後的事件也不重播已有的花
{
  const t = new FlowerTracker();
  t.onPoll(seats([X], [flower(141)]), B);
  check(t.onEvent(0, [X]).length === 0 && t.onEvent(1, [flower(141)]).length === 0, "重新整理後已有的花不重播");
  const added = t.onEvent(1, [flower(141), flower(142)]);
  check(added.length === 1 && added[0].id === 142, "重新整理後新補的花照常播");
}
// 3. 晚到的舊輪詢（上一局的回應比新局開局事件晚回來）不能污染新局的基線
{
  const t = new FlowerTracker();
  t.onGameStart(seats([X]), A);
  t.onGameStart(seats(), B);
  t.onPoll(seats([X]), A); // 舊的回應
  check(t.onEvent(0, [X]).length === 1, "晚到的上一局輪詢不碰基線：新局摸到 X 照樣播");
}
// 4. 一般輪詢不播特效、只記
{
  const t = new FlowerTracker();
  t.onGameStart(seats(), A);
  t.onPoll(seats([X]), A); // 漏收廣播，輪詢才看到
  check(t.onEvent(0, [X]).length === 0, "輪詢已經記下的花，之後的廣播不重播");
}
// 5. 開局事件回傳要播的開局補花
{
  const t = new FlowerTracker();
  const opening = t.onGameStart(seats([X], [], [flower(143)]), A);
  check(opening.map((p) => p.seat).join(",") === "0,2", "開局有花的座位才播開局補花");
}
// 6. 局的先後：連莊、換莊、換圈都是更新的一局
{
  const k = (r: RoundInfo) => gameKeyOf(r)!;
  check(compareGameKey(k(round(1, 1, 1)), k(round(1, 1, 0))) > 0, "連莊是更新的一局");
  check(compareGameKey(k(round(1, 2, 0)), k(round(1, 1, 3))) > 0, "換莊（局數加 1、連莊歸零）是更新的一局");
  check(compareGameKey(k(round(2, 1, 0)), k(round(1, 4, 2))) > 0, "換圈是更新的一局");
  check(compareGameKey(k(A), k(A)) === 0 && gameKeyOf(undefined) === null, "同一局相等；沒有局資訊回傳 null");
}
// 7. 沒有局資訊（舊伺服器）時維持原本的合併行為
{
  const t = new FlowerTracker();
  t.onPoll(seats([X]), undefined);
  check(t.onEvent(0, [X]).length === 0 && t.onEvent(0, [X, flower(144)]).length === 1, "沒有局資訊時照常合併、只播新補的");
}
if (failed) process.exit(1);
