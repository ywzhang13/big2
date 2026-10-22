// 牌桌音效的判斷（老闆 2026-10-22 選定：出牌聲 Q1「牌碰牌喀」、8 秒提醒聲 B2「偏高方波」滴滴）。
// 只管「什麼時候該響」，真正出聲交給 fx/engine.ts（走互動音效的音量、靜音）。不碰 React，node 測試可以用假時鐘跑（tests/_table-sound.ts）。
//   ・出牌聲：牌桌中間那張「最近打出的牌」換成新的一張（座位＋牌的 id 不同）就響一次，四家都一樣。
//     同一張牌的重複更新（自己打出時先畫、伺服器廣播再到、重新同步狀態）不會重響；剛進房、換房時看到的那張只記下不響。
//   ・提醒聲：輪到自己、要打牌時開始計時，6 秒還沒打就響一次，之後每 6 秒再響，最多 3 次（老闆 2026-10-22 從 8 秒改 6 秒）；
//     不在「輪到自己要打牌」（打出去了、輪到別人、換局、結算、離開）就停掉並歸零，下一次重新算。
//     切到別的分頁、縮小視窗時照樣計時、照樣響（老闆 2026-10-22：切換分頁就沒有滴滴）；切回來不補響、也不從頭算。
//     輪到自己時伺服器常會一起給自己回合的按鈕（自摸、暗槓、加槓、眼牌），這時照樣計時（老闆 2026-10-22 電腦版沒聽到滴滴聲的原因）；
//     別人打牌、等自己決定吃碰胡時本來就不是「輪到自己要打牌」，不會響。

export const REMIND_MS = 6000;
export const REMIND_MAX = 3;

/** 提醒聲要不要計時：輪到自己要打牌（needsDiscard，有沒有自摸、暗槓、加槓、眼牌按鈕都算）、還在打牌（不是結算）、人在房間裡。
 *  畫面在不在前景都算（切到別的分頁照樣響） */
export function remindActive(s: { needsDiscard: boolean; status: string; inRoom: boolean }): boolean {
  return s.needsDiscard && s.status === "playing" && s.inRoom;
}

type Timer = ReturnType<typeof setTimeout>;
export type ReminderClock = { setTimeout: (f: () => void, ms: number) => Timer; clearTimeout: (t: Timer) => void };
const realClock: ReminderClock = { setTimeout: (f, ms) => setTimeout(f, ms), clearTimeout: (t) => clearTimeout(t) };

export function createTurnReminder(play: () => void, clock: ReminderClock = realClock) {
  let timer: Timer | undefined;
  let count = 0;
  let active = false;
  const stop = () => {
    if (timer !== undefined) clock.clearTimeout(timer);
    timer = undefined;
    count = 0;
  };
  const schedule = () => {
    timer = clock.setTimeout(() => {
      timer = undefined;
      count++;
      play();
      if (count < REMIND_MAX) schedule();
    }, REMIND_MS);
  };
  return {
    /** on＝現在是「輪到自己、要打牌」；從 false 變 true 開始計時，變回 false 就停掉歸零 */
    set(on: boolean) {
      if (on === active) return;
      active = on;
      stop();
      if (on) schedule();
    },
    /** 測試用：這一輪已經響了幾次、還有沒有計時器在跑 */
    state: () => ({ active, count, pending: timer !== undefined }),
  };
}

/** 牌桌中間那張最近打出的牌 → 比對用的 key（沒有就是 null） */
export const discardKey = (f: { tile: { id: number }; from: number } | null | undefined) => (f ? `${f.from}:${f.tile.id}` : null);

export function createDiscardWatcher(play: () => void) {
  let last: string | null | undefined; // undefined＝還沒看過（剛進房）：第一次看到的只記下，不響
  return {
    update(key: string | null) {
      if (last !== undefined && key !== null && key !== last) play();
      last = key;
    },
    /** 換房、離開：下一次看到的又只記不響 */
    reset() { last = undefined; },
  };
}
