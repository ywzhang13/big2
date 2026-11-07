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
// 8. 審伯 2026-11-08 必修①：自己（selfSeat）重新整理、中途進房——快照裡已經有舊花，
//    下一個事件同時帶著舊花和新花時，只取出新花
{
  const t = new FlowerTracker();
  t.onPoll(seats([X]), A, 0); // 重新整理／中途進房：第一次拿到快照，自己座位已經有一張舊花 X，建立基線
  const added = t.onEvent(0, [X, flower(145)]); // mj_draw_tile 事件同時帶著舊花 X 和新花
  check(added.length === 1 && added[0].id === 145, "自己中途進房、快照已有舊花，事件同時帶舊花新花時只取出新花");
}
// 9. 自己（selfSeat）同一局裡輪詢只建立一次基線，不會因為漏掉事件而把之後輪詢多出來的花
//    誤記成「已知」——手牌、張數交給輪詢本身（不靠 FlowerTracker）維持正確，之後真的事件來了照樣能補播
{
  const t = new FlowerTracker();
  t.onPoll(seats([X]), A, 0); // 第一次快照建立基線
  t.onPoll(seats([X, flower(146)]), A, 0); // 完全漏掉事件：下一次輪詢伺服器快照已經多了一張花，基線不會跟著動
  t.onPoll(seats([X, flower(146)]), A, 0); // 再輪詢一次也一樣，不會壞掉、不會重複建立
  check(t.onEvent(0, [X, flower(146)]).length === 1, "自己的基線輪詢只建立一次，漏掉的事件之後靠真的事件補播一次，不多不少");
}
// 10. 自己（selfSeat）換新局（輪詢發現是更新的一局）：reset 要含自己在內重建基線，不能把自己漏掉
{
  const t = new FlowerTracker();
  t.onGameStart(seats([X]), A);
  t.onPoll(seats(), B, 0); // 漏收 mj_game_start，輪詢先看到新局；自己這局還沒有花
  check(t.onEvent(0, [X]).length === 1, "自己換新局時輪詢重建基線要含自己，新局摸到舊局用過的花 id 照樣播一次");
}
// 11. 別家（非 selfSeat）的輪詢行為完全不受 selfSeat 參數影響，維持原本「只記不播」
{
  const t = new FlowerTracker();
  t.onPoll(seats([], [X]), A, 0); // 自己是 0，座位 1 是別家
  check(t.onEvent(1, [X]).length === 0, "別家的花輪詢已經記下的，事件不會重播（selfSeat 不影響別家）");
}

if (failed) process.exit(1);
